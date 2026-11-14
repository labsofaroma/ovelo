import { expect, test, type Page } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";
import { expectNoAxeViolations, THEMES, useTheme } from "../helpers";
import { installTestWallet } from "./wallet";

/**
 * M9 compliance gate on the LOCAL FORK (e2e/fork/run.ts starts the app with AROMA_TRUST_PROXY=true,
 * so the platform country header is honoured, as on Vercel). Runs FIRST (trade.config.ts project
 * dependency): the shared test wallet has not accepted the terms yet.
 *   - a blocked country cannot quote (UI and API);
 *   - an allowed country must accept the terms before the first quote;
 *   - the risk disclosure is on the review, around the confirm button;
 *   - axe passes on the blocked, terms and review states, light and dark.
 */
const STOCK = process.env.E2E_STOCK_SYMBOL ?? "AAPLx";
const BASKET = process.env.E2E_BASKET_ID ?? "sol-energy";
const WALLET = e2eWallet().publicKey.toBase58();
const quoteBody = {
  target: { kind: "basket", basketId: BASKET },
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "1",
  taker: WALLET,
  supportedTransactionVersions: [0],
};

/**
 * Its own client IP (the fork app trusts x-real-ip behind its trusted proxy, as on Vercel), so
 * this spec's quotes do not use up the trade rate-limit window the purchase specs share.
 */
const OWN_IP = { "x-real-ip": "203.0.113.90" };

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

test.describe("blocked country (US)", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "US", ...OWN_IP } });

  test("cannot quote: honest notice in the ticket, 451 from the API, Action disabled", async ({
    page,
    request,
  }) => {
    const ticket = await openConnected(page);
    await expect(
      ticket.getByText("Mainnet purchases are not available here"),
    ).toBeVisible();
    await expect(ticket.getByRole("button", { name: "Get quote" })).toHaveCount(
      0,
    );
    // Paper practice stays available.
    await ticket.getByRole("radio", { name: "Paper practice" }).check();
    await expect(
      ticket.getByRole("button", { name: "Get quote" }),
    ).toBeVisible();

    const quote = await request.post("/api/v1/trade/quote", {
      data: quoteBody,
    });
    expect(quote.status()).toBe(451);
    expect((await quote.json()).code).toBe("JURISDICTION_RESTRICTED");
    const action = await request.post(
      `/api/v1/actions/baskets/${BASKET}?amount=1`,
      {
        data: { account: WALLET },
      },
    );
    expect(action.status()).toBe(451);
    const metadata = await (
      await request.get(`/api/v1/actions/baskets/${BASKET}`)
    ).json();
    expect(metadata.disabled).toBe(true);
  });

  for (const theme of THEMES)
    test(`blocked state has no axe violations (${theme})`, async ({ page }) => {
      await useTheme(page, theme);
      const ticket = await openConnected(page);
      await expect(
        ticket.getByText("Mainnet purchases are not available here"),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
});

test.describe("allowed country (DE)", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "DE", ...OWN_IP } });

  for (const theme of THEMES)
    test(`terms step has no axe violations (${theme})`, async ({ page }) => {
      await useTheme(page, theme);
      const ticket = await openConnected(page);
      await expect(
        ticket.getByRole("button", { name: "Sign to accept the terms" }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

  test("must accept the terms before the first quote; the review shows the risk disclosure", async ({
    page,
    request,
  }) => {
    const before = await request.post("/api/v1/trade/quote", {
      data: quoteBody,
    });
    expect(before.status()).toBe(403);
    expect((await before.json()).code).toBe("TERMS_REQUIRED");

    const ticket = await openConnected(page);
    await expect(ticket.getByRole("button", { name: "Get quote" })).toHaveCount(
      0,
    );
    await expect(
      ticket.getByText("Placeholder terms: pending counsel"),
    ).toBeVisible();
    await ticket
      .getByRole("button", { name: "Sign to accept the terms" })
      .click();
    await expect(
      ticket.getByRole("button", { name: "Get quote" }),
    ).toBeVisible();

    await ticket.getByLabel(/Amount/).fill("1");
    await ticket.getByRole("button", { name: "Get quote" }).click();
    const review = ticket.getByRole("region", {
      name: /Review mainnet spot purchase/,
    });
    await expect(review).toBeVisible();
    const disclosure = review.getByRole("region", { name: "Risk disclosure" });
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByText(/lose the full amount/)).toBeVisible();
    await expect(
      disclosure.getByRole("button", { name: "Sign and buy on mainnet" }),
    ).toBeVisible();
    await review.getByRole("button", { name: "Cancel" }).click();
  });

  for (const theme of THEMES)
    test(`review with the disclosure has no axe violations (${theme})`, async ({
      page,
    }) => {
      await useTheme(page, theme);
      const ticket = await openConnected(page);
      await ticket.getByLabel(/Amount/).fill("1");
      await ticket.getByRole("button", { name: "Get quote" }).click();
      const review = ticket.getByRole("region", {
        name: /Review mainnet spot purchase/,
      });
      await expect(
        review.getByRole("region", { name: "Risk disclosure" }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      await review.getByRole("button", { name: "Cancel" }).click();
    });
});
