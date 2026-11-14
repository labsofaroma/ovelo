import { expect, test, type Page } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";
import { installTestWallet } from "./wallet";

/**
 * Phase A caps (REWRITE-PLAN §7.3 W3) on the LOCAL FORK, with the beta defaults the runner sets
 * ($50 per trade, $200 per wallet per UTC day). Runs after beta-gate.spec.ts and
 * compliance.spec.ts (the shared wallet has beta access and has accepted the terms).
 *   - an order above the per-trade cap is refused with a coded error, before any route is built;
 *   - the review shows "max $50 per trade, $X left today" from the server's figures.
 */
const STOCK = process.env.E2E_STOCK_SYMBOL ?? "AAPLx";
const WALLET = e2eWallet().publicKey.toBase58();
test.use({
  extraHTTPHeaders: {
    "x-vercel-ip-country": "DE",
    "x-real-ip": "203.0.113.92",
  },
});

const ticketOf = (page: Page) =>
  page.locator("section", {
    has: page.getByRole("heading", { name: /^Buy / }),
  });

test("above $50 per trade → 422 TRADE_CAP_EXCEEDED", async ({ request }) => {
  const response = await request.post("/api/v1/trade/quote", {
    data: {
      target: {
        kind: "basket",
        basketId: process.env.E2E_BASKET_ID ?? "sol-energy",
      },
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "60",
      taker: WALLET,
      supportedTransactionVersions: [0],
    },
  });
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.code).toBe("TRADE_CAP_EXCEEDED");
  expect(body.message).toContain("$50");
});

test("the review shows the beta limits from the server", async ({ page }) => {
  await installTestWallet(page);
  await page.goto(`/stock/${STOCK}`);
  const ticket = ticketOf(page);
  await ticket.getByRole("button", { name: "Connect wallet" }).click();
  await expect(
    ticket.getByRole("button", { name: /Disconnect/ }),
  ).toBeVisible();
  await ticket.getByLabel(/Amount/).fill("1");
  await ticket.getByRole("button", { name: "Get quote" }).click();
  const review = ticket.getByRole("region", {
    name: /Review mainnet spot purchase/,
  });
  await expect(review.getByText("Beta limits")).toBeVisible();
  await expect(
    review.getByText(/^max \$50 per trade, \$[\d.]+ left today/),
  ).toBeVisible();
  await review.getByRole("button", { name: "Cancel" }).click();
});
