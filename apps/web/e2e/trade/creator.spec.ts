import { expect, test, type Page } from "@playwright/test";
import { e2eWallet, USDC } from "../fork/accounts";
// Aliased: the name `useTheme` reads as a React hook to eslint; it is a Playwright helper.
import {
  expectNoAxeViolations,
  THEMES,
  useTheme as applyTheme,
} from "../helpers";
import {
  api,
  createInvite,
  fillBuilder,
  LEGS,
  nodeSigner,
  sendToFork,
  SHOTS,
  signed,
} from "./creator-helpers";
import { installTestWallet, signAll } from "./wallet";

/**
 * M5 exit criterion (M5b B7), on the LOCAL MAINNET FORK with the local Postgres: admin CLI invite
 * → the E2E wallet connects, redeems, builds, signs and publishes → directory and basket page →
 * a buy through the trade ticket and one through the v1 Action → stats show the purchases →
 * refusals → archive, after which the basket cannot be bought. No mainnet transaction is sent:
 * every transaction goes to the fork at 127.0.0.1.
 */
test.describe.configure({ mode: "serial" });
test.skip(LEGS.length < 2, "needs E2E_CREATOR_LEGS from e2e/fork/run.ts");

const CREATOR = e2eWallet().publicKey.toBase58();
const NAME = "E2E creator basket";
const IP = {
  ui: "198.51.100.10",
  action: "198.51.100.11",
  guard: "198.51.100.12",
};
let basketId = "";
let inviteCode = "";

async function open(
  page: Page,
  path: string,
  theme: "light" | "dark" = "light",
) {
  await applyTheme(page, theme);
  await page.setExtraHTTPHeaders({ "x-real-ip": IP.ui });
  await page.goto(path);
  // The consent banner is fixed bottom-right; dismiss it with essential storage only ("Got it"
  // when no analytics is configured) so captures show the page.
  const consent = page.getByRole("button", {
    name: /^(Essential only|Got it)$/,
  });
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

test("admin CLI invite → connect → redeem → build → sign → publish", async ({
  page,
}) => {
  inviteCode = createInvite();
  await installTestWallet(page, { messageDelayMs: 1_500 });
  await open(page, "/basket/new");
  await page.screenshot({
    path: `${SHOTS}/builder-empty-light.png`,
    fullPage: true,
  });
  await fillBuilder(page, NAME, "E2EC");
  await page.screenshot({
    path: `${SHOTS}/builder-filled-light.png`,
    fullPage: true,
  });

  const publish = page.getByRole("region", { name: "Publish" });
  await publish.getByRole("button", { name: "Connect wallet" }).click();
  await expect(publish.getByText("Redeem your creator invite")).toBeVisible();
  await publish.getByLabel("Invite code").fill(inviteCode);
  await publish.getByLabel("Display name").fill("E2E Creator");
  await publish
    .getByRole("button", { name: "Redeem invite, sign and publish" })
    .click();
  await expect(
    publish.getByText(/Confirm the (invite|basket) in your wallet/),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/builder-publishing-light.png`,
    fullPage: true,
  });
  await expect(
    publish.getByText(`Published ${NAME} (E2EC), version 1.`),
  ).toBeVisible({
    timeout: 30_000,
  });
  const href = await publish
    .getByRole("link", { name: "View the basket" })
    .getAttribute("href");
  basketId = href!.split("/").pop()!;
  expect(basketId).toMatch(/^[0-9a-f-]{36}$/);
});

test("a second basket is published in dark mode (one signature: already a creator)", async ({
  page,
}) => {
  await installTestWallet(page, { messageDelayMs: 1_500 });
  await open(page, "/basket/new", "dark");
  await page.screenshot({
    path: `${SHOTS}/builder-empty-dark.png`,
    fullPage: true,
  });
  await fillBuilder(page, "E2E dark basket", "E2ED");
  await page.screenshot({
    path: `${SHOTS}/builder-filled-dark.png`,
    fullPage: true,
  });
  const publish = page.getByRole("region", { name: "Publish" });
  await publish.getByRole("button", { name: "Connect wallet" }).click();
  await publish.getByRole("button", { name: "Sign and publish" }).click();
  await expect(
    publish.getByText(/Confirm the basket in your wallet/),
  ).toBeVisible();
  await page.screenshot({
    path: `${SHOTS}/builder-publishing-dark.png`,
    fullPage: true,
  });
  await expect(publish.getByText(/Published E2E dark basket/)).toBeVisible({
    timeout: 30_000,
  });
});

for (const theme of THEMES)
  test(`directory and basket page show it, with zero axe violations (${theme})`, async ({
    page,
  }) => {
    await open(page, "/creators", theme);
    const card = page.getByRole("heading", { name: NAME });
    await expect(card).toBeVisible();
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: `${SHOTS}/directory-${theme}.png`,
      fullPage: true,
    });
    await card.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/basket/${basketId}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: NAME }),
    ).toBeVisible();
    await expect(page.getByText(/Published by E2E Creator/)).toBeVisible();
    await expect(page.getByText("No purchases yet.")).toBeVisible();
    await expectNoAxeViolations(page);
    await page.screenshot({
      path: `${SHOTS}/creator-basket-${theme}.png`,
      fullPage: true,
    });
    await open(page, "/basket/new", theme);
    await expectNoAxeViolations(page);
  });

test("buy through the trade ticket on the creator basket page, confirmed on the fork", async ({
  page,
}) => {
  await installTestWallet(page);
  await open(page, `/basket/${basketId}`);
  const ticket = page.locator("section", {
    has: page.getByRole("heading", { name: /^Buy / }),
  });
  await ticket.getByRole("button", { name: "Connect wallet" }).click();
  await ticket.getByLabel(/Amount/).fill("2");
  await ticket.getByRole("button", { name: "Get quote" }).click();
  const review = ticket.getByRole("region", {
    name: /Review mainnet spot purchase/,
  });
  await review.getByRole("button", { name: "Sign and buy on mainnet" }).click();
  await expect(ticket.getByText("Confirmed on Solana mainnet.")).toBeVisible();
});

test("buy through the v1 Solana Action, confirmed on the fork, receipt recorded by the callback", async ({
  request,
}) => {
  const rules = (await (await request.get("/actions.json")).json()) as {
    rules: { pathPattern: string }[];
  };
  expect(rules.rules[0]!.pathPattern).toBe("/basket/*");
  const meta = await api(
    request,
    IP.action,
    "GET",
    `/api/v1/actions/baskets/${basketId}`,
  );
  expect(meta.status).toBe(200);
  expect(meta.json.title).toMatch(/Mainnet spot purchase/);
  const post = await api(
    request,
    IP.action,
    "POST",
    `/api/v1/actions/baskets/${basketId}?amount=2`,
    {
      account: CREATOR,
    },
  );
  expect(post.status, JSON.stringify(post.json)).toBe(200);
  const [signedTx] = signAll([post.json.transaction as string]);
  const signature = await sendToFork(signedTx!);
  const next = (post.json.links as { next: { href: string } }).next.href;
  const confirm = await api(
    request,
    IP.action,
    "POST",
    new URL(next).pathname + new URL(next).search,
    {
      account: CREATOR,
      signature,
    },
  );
  expect(confirm.status, JSON.stringify(confirm.json)).toBe(200);
  expect(confirm.json).toMatchObject({ type: "completed", label: "Confirmed" });
});

test("stats show both purchases from confirmed receipts", async ({
  page,
  request,
}) => {
  const stats = await api(
    request,
    IP.guard,
    "GET",
    `/api/v1/creators/${CREATOR}/stats`,
  );
  expect(stats.status).toBe(200);
  const usage = stats.json.usage as {
    state: string;
    windows: {
      window: string;
      purchases: number;
      buyers: number;
      volume: { mint: string; raw: string }[];
    }[];
  };
  expect(usage.state).toBe("ok");
  const all = usage.windows.find((w) => w.window === "all")!;
  expect(all).toMatchObject({ purchases: 2, buyers: 1 });
  expect(all.volume).toHaveLength(1);
  expect(all.volume[0]!.mint).toBe(USDC);
  expect(BigInt(all.volume[0]!.raw)).toBe(4_000_000n);
  await open(page, `/basket/${basketId}`);
  const purchases = page.getByRole("region", { name: "Purchases" });
  await expect(
    purchases.getByRole("row", { name: /All time 2 1 4\.000000 USDC/ }),
  ).toBeVisible();
});

test("refusals: used invite, replayed challenge, wrong wallet, cross-site publish", async ({
  request,
}) => {
  const other = await nodeSigner();
  const profile = { displayName: "Other" };
  // A used invite is refused (single use).
  const used = await signed(request, IP.guard, other, {
    purpose: "redeem",
    profile,
  });
  const refusedInvite = await api(
    request,
    IP.guard,
    "POST",
    "/api/v1/creators/invites/redeem",
    {
      ...used,
      basketId: undefined,
      code: inviteCode,
      profile,
    },
  );
  expect(refusedInvite.status).toBe(403);
  // A fresh invite works once; replaying the same signed request is refused.
  const fresh = createInvite();
  const ok = await signed(request, IP.guard, other, {
    purpose: "redeem",
    profile,
  });
  const body = {
    wallet: ok.wallet,
    nonce: ok.nonce,
    signature: ok.signature,
    code: fresh,
    profile,
  };
  expect(
    (
      await api(
        request,
        IP.guard,
        "POST",
        "/api/v1/creators/invites/redeem",
        body,
      )
    ).status,
  ).toBe(201);
  const replay = await api(
    request,
    IP.guard,
    "POST",
    "/api/v1/creators/invites/redeem",
    body,
  );
  expect(replay.status).toBe(401);
  expect(replay.json.code).toBe("UNAUTHORIZED");
  // Another creator cannot publish over this basket.
  const basket = {
    name: "Hijack",
    ticker: "HIJACK",
    description: "",
    allocations: LEGS.map((leg, i) => ({
      mint: leg.mint,
      weightBps:
        Math.floor(10_000 / LEGS.length) + (i < 10_000 % LEGS.length ? 1 : 0),
    })),
  };
  const edit = await signed(request, IP.guard, other, {
    purpose: "publish",
    basketId,
    basket,
  });
  const wrong = await api(
    request,
    IP.guard,
    "POST",
    "/api/v1/creators/baskets",
    {
      action: "publish",
      wallet: other.wallet,
      nonce: edit.nonce,
      signature: edit.signature,
      basketId,
      basket,
    },
  );
  expect(wrong.status).toBe(403);
  expect(wrong.json.code).toBe("FORBIDDEN");
  // A cross-site publish never reaches the handler.
  const crossSite = await api(
    request,
    IP.guard,
    "POST",
    "/api/v1/creators/baskets",
    {},
    {
      origin: "https://evil.example",
    },
  );
  expect(crossSite.status).toBe(403);
  expect(crossSite.json.code).toBe("ORIGIN_FORBIDDEN");
});

test("archive with confirmation; an archived basket cannot be bought", async ({
  page,
  request,
}) => {
  await installTestWallet(page);
  await open(page, `/basket/${basketId}`);
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: "Archive basket" }).click();
  const dialog = page.getByRole("dialog", { name: `Archive ${NAME}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign and archive" }).click();
  await expect(page.getByText("Archived by its creator")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: /^Buy / })).toHaveCount(0);
  const quote = await api(request, IP.guard, "POST", "/api/v1/trade/quote", {
    target: { kind: "basket", basketId },
    inputMint: USDC,
    amount: "2",
    taker: CREATOR,
    supportedTransactionVersions: [0],
  });
  expect(quote.status).toBe(422);
  expect(quote.json.message).toMatch(/archived/);
  const action = await api(
    request,
    IP.guard,
    "POST",
    `/api/v1/actions/baskets/${basketId}?amount=2`,
    {
      account: CREATOR,
    },
  );
  expect(action.status).toBe(404);
});
