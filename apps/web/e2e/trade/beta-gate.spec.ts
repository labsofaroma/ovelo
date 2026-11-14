import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";
import { expectNoAxeViolations, THEMES, useTheme } from "../helpers";
import { installTestWallet, signMessageBase64 } from "./wallet";

/**
 * Phase A private-beta gate (REWRITE-PLAN §7.3 W2) on the LOCAL FORK. e2e/fork/run.ts starts the
 * app with AROMA_BETA_GATE=on and the local Postgres (scripts/local-db.sh). Runs FIRST
 * (trade.config.ts), while the shared test wallet has no beta access and no terms:
 *   - no access → the API refuses (BETA_ACCESS_REQUIRED), the ticket shows the redeem step,
 *     the Action GET is disabled and the page carries the private-beta banner;
 *   - an invite issued with the admin CLI is redeemed in the ticket (wallet-signed) → the beta
 *     gate no longer refuses: the next check is the terms, which compliance.spec.ts accepts
 *     before it quotes and reviews with this same wallet;
 *   - the used code is refused.
 */
test.skip(
  process.env.E2E_BETA_GATE !== "on",
  "needs the beta gate on and the local Postgres (E2E_CREATOR=0 turns both off)",
);

const STOCK = process.env.E2E_STOCK_SYMBOL ?? "AAPLx";
const BASKET = process.env.E2E_BASKET_ID ?? "sol-energy";
const WALLET = e2eWallet().publicKey.toBase58();
const OWN_IP = { "x-real-ip": "203.0.113.91" };
const quoteBody = {
  target: { kind: "basket", basketId: BASKET },
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "1",
  taker: WALLET,
  supportedTransactionVersions: [0],
};

test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "DE", ...OWN_IP } });
test.describe.configure({ mode: "serial" });

/** The admin CLI against the local Postgres; the code is printed once. */
function issueInvite(): string {
  const out = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/create-beta-invite.ts", "--days", "1"],
    { encoding: "utf8", env: process.env },
  );
  const code = /Code \(shown once, not stored\): (\S+)/.exec(out)?.[1];
  if (!code) throw new Error("the CLI printed no code");
  return code;
}

const ticketOf = (page: Page) =>
  page.locator("section", {
    has: page.getByRole("heading", { name: /^Buy / }),
  });

async function openConnected(page: Page) {
  await installTestWallet(page);
  await page.goto(`/v1/stock/${STOCK}`);
  const ticket = ticketOf(page);
  await ticket.getByRole("button", { name: "Connect wallet" }).click();
  await expect(
    ticket.getByRole("button", { name: /Disconnect/ }),
  ).toBeVisible();
  return ticket;
}

let code = "";

test("no access: refused by the API, redeem step in the ticket, Action disabled, banner shown", async ({
  page,
  request,
}) => {
  const quote = await request.post("/api/v1/trade/quote", { data: quoteBody });
  expect(quote.status()).toBe(403);
  expect((await quote.json()).code).toBe("BETA_ACCESS_REQUIRED");
  const action = await request.post(
    `/api/v1/actions/baskets/${BASKET}?amount=1`,
    {
      data: { account: WALLET },
    },
  );
  expect((await action.json()).code).toBe("BETA_ACCESS_REQUIRED");
  const metadata = await (
    await request.get(`/api/v1/actions/baskets/${BASKET}`)
  ).json();
  expect(metadata.disabled).toBe(true);
  expect(metadata.error.message).toMatch(/private beta/);

  const ticket = await openConnected(page);
  await expect(
    page.getByRole("complementary", { name: "Private beta" }),
  ).toBeVisible();
  await expect(
    ticket.getByRole("region", { name: "Private beta access" }),
  ).toBeVisible();
  await expect(ticket.getByRole("button", { name: "Get quote" })).toHaveCount(
    0,
  );
  // Paper practice stays open.
  await ticket.getByRole("radio", { name: "Paper practice" }).check();
  await expect(ticket.getByRole("button", { name: "Get quote" })).toBeVisible();
});

for (const theme of THEMES)
  test(`redeem step has no axe violations (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    const ticket = await openConnected(page);
    await expect(
      ticket.getByRole("region", { name: "Private beta access" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

test("redeem an invite in the ticket → the beta gate lets this wallet quote", async ({
  page,
  request,
}) => {
  code = issueInvite();
  const ticket = await openConnected(page);
  await ticket.getByLabel("Invite code").fill(code);
  await ticket
    .getByRole("button", { name: "Sign to redeem the invite" })
    .click();
  await expect(
    ticket.getByRole("region", { name: "Private beta access" }),
  ).toHaveCount(0);
  // Past the beta gate: the next gate is the terms (accepted, then quoted, in compliance.spec.ts).
  await expect(
    ticket.getByRole("button", { name: "Sign to accept the terms" }),
  ).toBeVisible();
  const quote = await request.post("/api/v1/trade/quote", { data: quoteBody });
  expect((await quote.json()).code).toBe("TERMS_REQUIRED");
  const status = await (
    await request.get(`/api/v1/beta/status?wallet=${WALLET}`)
  ).json();
  expect(status).toEqual({ gate: true, access: true });
});

test("a used code is refused", async ({ request }) => {
  expect(code).not.toBe("");
  const issued = await request.post("/api/v1/beta/challenge", {
    data: { wallet: WALLET, code },
  });
  expect(issued.status()).toBe(200);
  const { nonce, message } = (await issued.json()) as {
    nonce: string;
    message: string;
  };
  const redeemed = await request.post("/api/v1/beta/redeem", {
    data: {
      wallet: WALLET,
      code,
      nonce,
      signature: signMessageBase64(Buffer.from(message).toString("base64")),
    },
  });
  expect(redeemed.status()).toBe(403);
  expect((await redeemed.json()).code).toBe("BETA_INVITE_INVALID");
});
