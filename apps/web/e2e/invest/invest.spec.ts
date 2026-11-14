import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createSolanaRpc, type Address } from "@solana/kit";
import { planAddresses, TOKEN_PROGRAM_ID } from "@aroma/guard";
import { signQStashRequest } from "../../../keeper/src/qstash";
import { expectNoAxeViolations, THEMES, useTheme } from "../helpers";
import { installWallet, signTransaction, state } from "./wallet";

/**
 * M7 B9 on a local validator: faucet → create a plan in the UI → the keeper executes three
 * installments and skips one on purpose (paused past the catch-up window) → the timeline shows
 * executed and skipped periods → close + revoke in the UI (delegation gone, rent back) → the skip
 * alert fired. Negative cases: tampered authorization, cross-cluster wallet, faucet over its
 * limit, keeper call without a valid QStash signature; a forced failure is dead-lettered.
 */
test.describe.configure({ mode: "serial" });

const s = state();
const rpc = createSolanaRpc(s.rpcUrl);
const PERIOD = 15n;
const KEEPER = process.env.E2E_KEEPER_URL!;
const BASE = process.env.E2E_BASE_URL!;
let planPda = "";
let startsAt = 0n;

async function chainTime(): Promise<bigint> {
  const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
  return BigInt((await rpc.getBlockTime(slot).send()) ?? 0);
}
async function waitForChain(t: bigint): Promise<void> {
  while ((await chainTime()) < t) await new Promise((r) => setTimeout(r, 1000));
}
async function runKeeper(request: APIRequestContext) {
  const body = JSON.stringify({ trigger: "e2e" });
  const response = await request.post(KEEPER, {
    data: body,
    headers: {
      "Content-Type": "application/json",
      "Upstash-Signature": signQStashRequest({
        key: process.env.E2E_QSTASH_KEY!,
        url: KEEPER,
        body,
      }),
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as {
    outcomes: {
      plan: string;
      status: string;
      period: number | null;
      newlySkipped?: number;
    }[];
  };
}
async function connect(page: Page) {
  await page.goto("/v1/invest");
  await expect(page.getByTestId("cluster-label")).toContainText(
    "no real value",
  );
  await page.getByRole("button", { name: "Connect wallet" }).click();
}
const headers = { Origin: BASE, "Content-Type": "application/json" };

test("a wallet that declares only mainnet is refused on the localnet page", async ({
  page,
}) => {
  await installWallet(page, s.walletB, ["solana:mainnet"]);
  await connect(page);
  await expect(page.getByTestId("wallet-error")).toContainText(
    "local validator only",
  );
  await expect(page.getByTestId("faucet-claim")).toHaveCount(0);
});

test("faucet: a wallet-signed claim with the Turnstile test key; a second claim is over the limit", async ({
  page,
}) => {
  await installWallet(page, s.wallet);
  await connect(page);
  const token = page.locator(
    '[data-testid="faucet-turnstile"] input[name="cf-turnstile-response"]',
  );
  await expect(token).not.toHaveValue("", { timeout: 30_000 });
  await page.getByTestId("faucet-claim").click();
  await expect(page.getByTestId("faucet-result")).toContainText(
    "Received 100 tUSD",
  );
  await expect(token).not.toHaveValue("", { timeout: 30_000 });
  await page.getByTestId("faucet-claim").click();
  await expect(page.getByTestId("faucet-error")).toContainText(
    "already claimed",
  );
});

/** Fill the wizard and open its review (prepares the transaction; nothing is signed). */
async function openReview(page: Page) {
  await installWallet(page, s.wallet);
  await connect(page);
  await page.getByTestId("wizard-mode-assets").check();
  await page.getByTestId("wizard-weight-AAPL").fill("60");
  await page.getByTestId("wizard-weight-TSLA").fill("40");
  await page.getByTestId("wizard-amount").fill("10");
  await page.getByTestId("wizard-period").selectOption(String(PERIOD));
  await page.getByTestId("wizard-periods").fill("4");
  await page.getByTestId("wizard-review").click();
}

// Phase A (COMPLIANCE.md §5): the devnet risk disclosure wraps the confirm control.
for (const theme of THEMES)
  test(`the review shows the devnet risk disclosure, axe clean (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await openReview(page);
    const disclosure = page.getByRole("region", { name: "Risk disclosure" });
    await expect(disclosure).toContainText("test tokens of no value");
    await expect(disclosure.getByTestId("sign-and-create")).toBeVisible();
    await expect(
      page.getByText("Devnet: test tokens, no real value").first(),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

test("create a plan in the UI: the review states the approval in plain words", async ({
  page,
  request,
}) => {
  await installWallet(page, s.wallet);
  await connect(page);
  await page.getByTestId("wizard-mode-assets").check();
  await page.getByTestId("wizard-weight-AAPL").fill("60");
  await page.getByTestId("wizard-weight-TSLA").fill("40");
  await page.getByTestId("wizard-amount").fill("10");
  await page.getByTestId("wizard-period").selectOption(String(PERIOD));
  await page.getByTestId("wizard-periods").fill("4");
  await page.getByTestId("wizard-review").click();
  const approval = page.getByTestId("review-approval");
  await expect(approval).toContainText("up to 20 tUSD per period");
  await expect(approval).toContainText(
    "at most one installment of 10 tUSD per period",
  );
  await page.getByTestId("sign-and-create").click();
  await expect(page.getByTestId("wizard-done")).toBeVisible();
  const plans = (await (
    await request.get(`/api/v1/plans?owner=${s.wallet.address}`)
  ).json()) as { plans: { pda: string; startsAt: string }[] };
  expect(plans.plans).toHaveLength(1);
  planPda = plans.plans[0]!.pda;
  startsAt = BigInt(plans.plans[0]!.startsAt);
});

test("the keeper refuses calls without a valid QStash signature", async ({
  request,
}) => {
  expect((await request.post(KEEPER, { data: "{}" })).status()).toBe(401);
  const forged = signQStashRequest({
    key: "sig_forged_" + "f".repeat(24),
    url: KEEPER,
    body: "{}",
  });
  expect(
    (
      await request.post(KEEPER, {
        data: "{}",
        headers: { "Upstash-Signature": forged },
      })
    ).status(),
  ).toBe(401);
});

test("three installments execute; period 2 is skipped because the keeper paused past the window", async ({
  request,
}) => {
  const outcomeFor = async () =>
    (await runKeeper(request)).outcomes.find((o) => o.plan === planPda);
  // The scenario needs the first run inside period 0 (15 s); fail loudly if setup was too slow.
  expect(
    (await chainTime()) - startsAt,
    "plan creation took longer than one period",
  ).toBeLessThan(PERIOD);
  expect(await outcomeFor()).toMatchObject({ status: "executed", period: 0 });
  await waitForChain(startsAt + PERIOD + 1n);
  expect(await outcomeFor()).toMatchObject({ status: "executed", period: 1 });
  // Paused through periods 2 and 3; in period 4 the oldest runnable is 3, so 2 is lost.
  await waitForChain(startsAt + 4n * PERIOD + 1n);
  expect(await outcomeFor()).toMatchObject({
    status: "executed",
    period: 3,
    newlySkipped: 1,
  });
});

test("the timeline shows executed and skipped periods from the chain and receipts", async ({
  page,
}) => {
  await installWallet(page, s.wallet);
  await connect(page);
  const rows = page.getByTestId("timeline-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAttribute("data-status", "executed");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "executed");
  await expect(rows.nth(2)).toHaveAttribute("data-status", "skipped");
  await expect(rows.nth(3)).toHaveAttribute("data-status", "executed");
  await expect(rows.nth(2)).toContainText("Skipped");
  await expect(page.getByTestId("plan-executed")).toContainText("3");
  await expect(page.getByTestId("plan-skipped")).toContainText("1");
});

test("the skip alert reached the webhook", async ({ request }) => {
  const alerts = (await (
    await request.get(process.env.E2E_ALERTS_URL!)
  ).json()) as { text?: string }[];
  expect(
    alerts.some(
      (a) =>
        /installment_skipped/.test(a.text ?? "") && a.text!.includes(planPda),
    ),
  ).toBe(true);
});

test("a tampered authorization is refused (403) and nothing is sent", async ({
  request,
}) => {
  const prepared = (await (
    await request.post("/api/v1/plans/prepare-create", {
      headers,
      data: {
        owner: s.wallet.address,
        fundingAmount: "1000000",
        periodSeconds: 15,
        periods: 2,
        selection: {
          kind: "assets",
          outputs: [{ mint: s.stocks[0]!.mint, weightBps: 10_000 }],
        },
      },
    })
  ).json()) as { authorization: string; transaction: string };
  const tampered =
    prepared.authorization.slice(0, 20) +
    (prepared.authorization[20] === "A" ? "B" : "A") +
    prepared.authorization.slice(21);
  const response = await request.post("/api/v1/plans/submit", {
    headers,
    data: {
      authorization: tampered,
      transaction: signTransaction(
        s.wallet.secret,
        s.wallet.address,
        prepared.transaction,
      ),
    },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "AUTHORIZATION_INVALID",
  });
});

test("a forced failure (installment above the wallet's balance) is dead-lettered and alerted", async ({
  request,
}) => {
  const prepared = (await (
    await request.post("/api/v1/plans/prepare-create", {
      headers,
      data: {
        owner: s.wallet.address,
        fundingAmount: "200000000",
        periodSeconds: 15,
        periods: 2,
        selection: {
          kind: "assets",
          outputs: [{ mint: s.stocks[0]!.mint, weightBps: 10_000 }],
        },
      },
    })
  ).json()) as { authorization: string; transaction: string; plan: string };
  const submitted = await request.post("/api/v1/plans/submit", {
    headers,
    data: {
      authorization: prepared.authorization,
      transaction: signTransaction(
        s.wallet.secret,
        s.wallet.address,
        prepared.transaction,
      ),
    },
  });
  expect(submitted.status(), await submitted.text()).toBe(200);
  const outcome = (await runKeeper(request)).outcomes.find(
    (o) => o.plan === prepared.plan,
  );
  expect(outcome).toMatchObject({ status: "dead_lettered" });
  const dlq = (await (
    await request.post(process.env.E2E_REDIS_URL!, {
      headers: {
        Authorization: `Bearer ${process.env.E2E_REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: ["LRANGE", "keeper:dlq", "0", "-1"],
    })
  ).json()) as { result: string[] };
  expect(
    dlq.result
      .map((e) => JSON.parse(e) as { plan: string })
      .some((e) => e.plan === prepared.plan),
  ).toBe(true);
  const alerts = (await (
    await request.get(process.env.E2E_ALERTS_URL!)
  ).json()) as { text?: string }[];
  expect(alerts.some((a) => /installment_failed/.test(a.text ?? ""))).toBe(
    true,
  );
});

for (const theme of THEMES)
  test(`/v1/invest has zero axe violations with plans and timeline (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await installWallet(page, s.wallet);
    await connect(page);
    await expect(page.getByTestId("timeline-row").first()).toBeVisible();
    await expectNoAxeViolations(page);
  });

test("close + revoke in the UI: the plan and its delegation are gone and rent returns to the owner", async ({
  page,
}) => {
  await installWallet(page, s.wallet);
  await connect(page);
  const before = (await rpc.getBalance(s.wallet.address as Address).send())
    .value;
  const card = page.locator(
    `[data-testid="plan-card"][data-plan="${planPda}"]`,
  );
  await card.getByTestId("close-plan").click();
  await page.getByTestId("close-confirm").click();
  await expect(page.getByTestId("close-result")).toContainText(
    "Recurring approval revoked: the delegation account no longer exists.",
  );
  await expect(page.getByTestId("close-result")).toContainText(
    "Rent returned to your wallet",
  );
  const { recurringDelegation } = await planAddresses({
    owner: s.wallet.address as Address,
    fundingMint: s.testUsd as Address,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    nonce: 1n,
  });
  expect(
    (await rpc.getAccountInfo(planPda as Address).send()).value,
  ).toBeNull();
  expect(
    (await rpc.getAccountInfo(recurringDelegation).send()).value,
  ).toBeNull();
  expect(
    (await rpc.getBalance(s.wallet.address as Address).send()).value,
  ).toBeGreaterThan(before);
});
