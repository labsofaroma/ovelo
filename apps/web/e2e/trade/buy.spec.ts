import { expect, test, type Page } from "@playwright/test";
import { e2eWallet, USDC } from "../fork/accounts";
import { expectNoAxeViolations, THEMES, useTheme } from "../helpers";
import { installTestWallet, signAll } from "./wallet";

/**
 * M4 exit criterion: browse → quote → review → sign → submit → confirm, on a LOCAL MAINNET FORK
 * (see e2e/fork/run.ts). The submit endpoint broadcasts to the fork's RPC only.
 */
const STOCK = process.env.E2E_STOCK_SYMBOL ?? "AAPLx";
const BASKET = process.env.E2E_BASKET_ID ?? "sol-energy";

async function buy(page: Page, path: string, amount: string) {
  await installTestWallet(page);
  await page.goto(path);
  const ticket = page.locator("section", {
    has: page.getByRole("heading", { name: /^Buy / }),
  });
  await expect(
    ticket.getByRole("radio", { name: "Mainnet spot purchase" }),
  ).toBeChecked();
  await ticket.getByRole("button", { name: "Connect wallet" }).click();
  await expect(
    ticket.getByRole("button", { name: /Disconnect/ }),
  ).toBeVisible();
  await ticket.getByLabel(/Amount/).fill(amount);
  await ticket.getByRole("button", { name: "Get quote" }).click();
  const review = ticket.getByRole("region", {
    name: /Review mainnet spot purchase/,
  });
  await expect(review).toBeVisible();
  // PRODUCT.md: source, route, price impact, fees, minimum received and quote age are shown.
  for (const label of [
    "Source",
    "Route",
    "Price impact",
    "Network fee",
    "Quote age",
    "Expires in",
  ])
    await expect(
      review.getByText(label, { exact: true }).first(),
    ).toBeVisible();
  await expect(review.getByText(/minimum received/).first()).toBeVisible();
  await review.getByRole("button", { name: "Sign and buy on mainnet" }).click();
  await expect(ticket.getByText("Confirmed on Solana mainnet.")).toBeVisible();
  await expect(
    ticket.getByRole("link", { name: /View transaction/ }).first(),
  ).toBeVisible();
}

test("stock: browse → quote → review → sign → submit → confirmed on the fork", async ({
  page,
}) => {
  await page.goto("/markets");
  await buy(page, `/stock/${STOCK}`, "1");
});

test("basket: one order buys every constituent, confirmed on the fork", async ({
  page,
}) => {
  await buy(page, `/basket/${BASKET}`, "2");
});

test("portfolio lists the fork holdings, the confirmed orders and P&L from their exact fills", async ({
  page,
}) => {
  await installTestWallet(page);
  await page.goto("/portfolio");
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();
  // M11: P&L from Aroma receipts and the confirmed transactions' exact fills, average cost.
  await expect(
    page.getByRole("heading", { name: "Profit and loss" }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Average cost of what this wallet bought/),
  ).toBeVisible();
  const pnlTable = page.getByRole("table", { name: "Profit and loss" });
  await expect(
    pnlTable.getByRole("rowheader", {
      name: process.env.E2E_STOCK_SYMBOL ?? "AAPLx",
    }),
  ).toBeVisible();
  await expect(page.getByText(/Realized P&L: not shown/)).toBeVisible();
  // Both orders from the buy tests are in the activity list, confirmed.
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(activity.getByText("Stock purchase")).toBeVisible();
  await expect(activity.getByText(/^Basket /).first()).toBeVisible();
  await expect(activity.getByText("confirmed").first()).toBeVisible();
});

test("a tampered authorization is refused and nothing is broadcast", async ({
  request,
}) => {
  const taker = e2eWallet().publicKey.toBase58();
  const quote = await request.post("/api/v1/trade/quote", {
    data: {
      target: { kind: "basket", basketId: BASKET },
      inputMint: USDC,
      // The recorded basket order (e2e/fork/run.ts records routes for 2 USDC).
      amount: "2",
      taker,
      supportedTransactionVersions: [0],
    },
  });
  expect(quote.status()).toBe(200);
  const body = await quote.json();
  const signed = signAll(body.transactions);
  const tampered = body.authorization.replace(/.$/, (c: string) =>
    c === "A" ? "B" : "A",
  );
  const response = await request.post("/api/v1/trade/submit", {
    data: { authorization: tampered, signedTransactions: signed },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({
    code: "AUTHORIZATION_INVALID",
    message: "This trade authorization is not valid. Request a new quote.",
  });
});

test("an expired quote is refused at submit", async ({ request }) => {
  test.setTimeout(150_000);
  const taker = e2eWallet().publicKey.toBase58();
  const quote = await request.post("/api/v1/trade/quote", {
    data: {
      target: { kind: "basket", basketId: BASKET },
      inputMint: USDC,
      // The recorded basket order (e2e/fork/run.ts records routes for 2 USDC).
      amount: "2",
      taker,
      supportedTransactionVersions: [0],
    },
  });
  expect(quote.status()).toBe(200);
  const body = await quote.json();
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, body.expiresAt - Date.now()) + 1_000),
  );
  const response = await request.post("/api/v1/trade/submit", {
    data: {
      authorization: body.authorization,
      signedTransactions: signAll(body.transactions),
    },
  });
  expect(response.status()).toBe(410);
  expect((await response.json()).code).toBe("QUOTE_EXPIRED");
});

test("rate limit: the trade bucket answers 429 with { code, message }", async ({
  request,
}) => {
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const response = await request.post("/api/v1/trade/quote", {
      headers: { "x-real-ip": "203.0.113.42" },
      data: { not: "a quote" },
    });
    statuses.push(response.status());
  }
  expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
  expect(statuses.at(-1)).toBe(429);
});

test("paper trade end to end: practice order, no transaction, no wallet", async ({
  page,
}) => {
  await page.goto(`/stock/${STOCK}`);
  const ticket = page.locator("section", {
    has: page.getByRole("heading", { name: /^Buy / }),
  });
  await ticket.getByRole("radio", { name: "Paper practice" }).check();
  await ticket.getByLabel(/Amount/).fill("25");
  await ticket.getByRole("button", { name: "Get quote" }).click();
  const review = ticket.getByRole("region", {
    name: /Review paper practice order/,
  });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Place paper order" }).click();
  await expect(
    ticket.getByText(/Paper order filled\. This was practice/),
  ).toBeVisible();
});

for (const theme of THEMES) {
  test(`new pages have zero axe violations (${theme})`, async ({ page }) => {
    await useTheme(page, theme);
    await installTestWallet(page);
    for (const path of ["/portfolio", `/stock/${STOCK}`, `/basket/${BASKET}`]) {
      await page.goto(path);
      await expectNoAxeViolations(page);
    }
    // The review screen too.
    await page.goto(`/stock/${STOCK}`);
    const ticket = page.locator("section", {
      has: page.getByRole("heading", { name: /^Buy / }),
    });
    await ticket.getByRole("radio", { name: "Paper practice" }).check();
    await ticket.getByLabel(/Amount/).fill("10");
    await ticket.getByRole("button", { name: "Get quote" }).click();
    await expect(
      ticket.getByRole("region", { name: /Review paper/ }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
