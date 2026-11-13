import { expect, test } from "vitest";
import { resolveReviewedMarketBaskets, type MarketAsset } from "../markets";
import { testAsset, testBasket, testSnapshot } from "../markets/test-fixtures";
import {
  createPaperAccount,
  executePaperOrder,
  executePaperBasket,
  valuePaperAccount,
  parsePaperAccount,
  createPaperPlan,
  runDuePaperPlans,
  nextPaperExecution,
} from "./index";

const now = "2026-09-12T12:00:00.000Z";
function asset(overrides: Partial<MarketAsset> = {}): MarketAsset {
  return testAsset({
    mint: "test-mint",
    symbol: "TEST",
    priceUsd: 50,
    priceObservedAt: now,
    verified: true,
    tradingHalted: false,
    ...overrides,
  });
}

test("paper buy and partial sale conserve cash and remaining cost basis without mutating input", () => {
  const start = createPaperAccount(1000);
  const bought = executePaperOrder(start, asset(), "buy", 200, now);
  expect(start.cashUsd).toBe(1000);
  expect(start.positions.length).toBe(0);
  expect(bought.cashUsd).toBe(800);
  expect(bought.positions[0].quantity).toBe(4);
  const sold = executePaperOrder(
    bought,
    asset({ priceUsd: 100 }),
    "sell",
    200,
    now,
  );
  expect(sold.cashUsd).toBe(1000);
  expect(sold.positions[0].quantity).toBe(2);
  expect(sold.positions[0].costBasisUsd).toBe(100);
  expect(
    valuePaperAccount(sold, [asset({ priceUsd: 100 })]).profitLossUsd,
  ).toBe(200);
});

test("rejects insufficient funds, overselling, missing quotes, stale quotes, halted assets and invalid numbers", () => {
  const start = createPaperAccount(1000);
  for (const amount of [0, -1, NaN, Infinity, 1001])
    expect(() =>
      executePaperOrder(start, asset(), "buy", amount, now),
    ).toThrow();
  expect(() => executePaperOrder(start, asset(), "sell", 100, now)).toThrow(
    /holdings/,
  );
  expect(() =>
    executePaperOrder(start, asset({ priceUsd: null }), "buy", 100, now),
  ).toThrow(/live market price/);
  expect(() =>
    executePaperOrder(
      start,
      asset({ priceObservedAt: "2026-09-12T11:00:00Z" }),
      "buy",
      100,
      now,
    ),
  ).toThrow(/Refresh/);
  expect(() =>
    executePaperOrder(start, asset({ tradingHalted: true }), "buy", 100, now),
  ).toThrow(/unavailable/);
  expect(() =>
    // @ts-expect-error: an invalid side from untyped callers must still be rejected at runtime.
    executePaperOrder(start, asset(), "hold", 100, now),
  ).toThrow(/side/);
});

test("basket is all-or-nothing and requires complete allocations", () => {
  const start = createPaperAccount(1000);
  const basket = testBasket({
    available: true,
    assets: [
      { asset: asset(), weight: 5000 },
      { asset: asset({ mint: "other", priceUsd: null }), weight: 5000 },
    ],
  });
  expect(() => executePaperBasket(start, basket, 500, now)).toThrow();
  expect(start.cashUsd).toBe(1000);
  expect(start.orders).toEqual([]);
  expect(() =>
    executePaperBasket(
      start,
      { ...basket, assets: [{ asset: asset(), weight: 9999 }] },
      500,
      now,
    ),
  ).toThrow(/100%/);
});

test("missing prices make portfolio valuation unavailable instead of valuing holdings at zero", () => {
  const bought = executePaperOrder(
    createPaperAccount(),
    asset(),
    "buy",
    100,
    now,
  );
  const value = valuePaperAccount(bought, []);
  expect(value.totalUsd).toBe(null);
  expect(value.profitLossUsd).toBe(null);
  expect(value.unpricedMints).toEqual(["test-mint"]);
});

test("monthly plans clamp to month-end; app-open execution does not fabricate missed installments", () => {
  expect(nextPaperExecution("monthly", "2026-01-31T12:00:00Z")).toBe(
    "2026-02-28T12:00:00.000Z",
  );
  let account = createPaperPlan(
    createPaperAccount(1000),
    {
      targetId: "test-mint",
      targetType: "asset",
      name: "Test",
      amountUsd: 100,
      frequency: "daily",
    },
    "2026-09-01T12:00:00Z",
  );
  account = runDuePaperPlans(account, testSnapshot({ assets: [asset()] }), now);
  expect(account.orders.length).toBe(1);
  expect(account.cashUsd).toBe(900);
  expect(account.plans[0].nextExecutionAt).toBe("2026-09-13T12:00:00.000Z");
  expect(
    runDuePaperPlans(account, testSnapshot({ assets: [asset()] }), now).orders
      .length,
  ).toBe(1);
});

test("persisted state rejects corruption and migrates a valid version-one account without plans", () => {
  const account = createPaperAccount();
  expect(parsePaperAccount(JSON.parse(JSON.stringify(account)))).toEqual(
    account,
  );
  expect(parsePaperAccount({ ...account, cashUsd: -1 })).toBe(null);
  expect(
    parsePaperAccount({
      ...account,
      positions: [
        { mint: "a", symbol: "A", quantity: Infinity, costBasisUsd: 1 },
      ],
    }),
  ).toBe(null);
  expect(parsePaperAccount({ ...account, orders: [{}] })).toBe(null);
  const { plans: _plans, ...legacy } = account;
  expect(parsePaperAccount(legacy)?.plans).toEqual([]);
});

test("an existing paper basket plan retains all original members after mainnet publication is narrowed", () => {
  const symbols = ["NVDA", "AMD", "AVGO", "TSM", "ASML"];
  const assets = symbols.map((symbol) =>
    asset({
      mint: symbol,
      symbol: `${symbol}x`,
      underlyingSymbol: symbol,
      issuer: "xstocks",
    }),
  );
  const account = createPaperPlan(
    createPaperAccount(1000),
    {
      targetId: "sol-chips",
      targetType: "basket",
      name: "The Silicon Stack",
      amountUsd: 100,
      frequency: "daily",
    },
    "2026-09-01T12:00:00Z",
  );
  const snapshot = testSnapshot({
    assets,
    baskets: resolveReviewedMarketBaskets(assets),
  });
  const result = runDuePaperPlans(account, snapshot, now);
  expect(result.plans[0].lastError).toBe(null);
  expect(result.orders.length).toBe(5);
  expect(result.positions.map((position) => position.mint).sort()).toEqual(
    [...symbols].sort(),
  );
  expect(Math.abs(result.cashUsd - 900) < 1e-8).toBeTruthy();
  assets[4]!.priceUsd = null;
  const blocked = runDuePaperPlans(account, snapshot, now);
  expect(
    blocked.orders.length,
    "missing historical leg still fails the complete paper installment",
  ).toBe(0);
  expect(blocked.cashUsd).toBe(1000);
});
