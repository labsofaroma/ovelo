import { expect, test } from "vitest";
import {
  createPaperAccount,
  executePaperOrder,
  quotePaperSwap,
  executePaperSwap,
  parsePaperAccount,
  valuePaperAccount,
} from "./index";
import { testAsset } from "../markets/test-fixtures";

const now = "2026-09-13T00:00:00.000Z";
const input = testAsset({
  mint: "input-stock",
  symbol: "INPUT",
  priceUsd: 50,
  priceObservedAt: now,
  verified: true,
  tradingHalted: false,
});
const output = testAsset({
  mint: "output-stock",
  symbol: "OUTPUT",
  priceUsd: 25,
  priceObservedAt: now,
  verified: true,
  tradingHalted: false,
});

test("paper stock swap conserves equity and cash while realizing the input cost basis", () => {
  const account = executePaperOrder(
    createPaperAccount(1000),
    input,
    "buy",
    1000,
    now,
  );
  const original = JSON.stringify(account);
  const appreciated = { ...input, priceUsd: 75 };
  const quote = quotePaperSwap(account, appreciated, output, 5, now);
  expect(quote.valueUsd).toBe(375);
  expect(quote.outputQuantity).toBe(15);
  const swapped = executePaperSwap(account, appreciated, output, 5, now);
  expect(swapped.cashUsd).toBe(account.cashUsd);
  expect(swapped.positions.find((p) => p.mint === input.mint)!.quantity).toBe(
    15,
  );
  expect(
    swapped.positions.find((p) => p.mint === input.mint)!.costBasisUsd,
  ).toBe(750);
  expect(swapped.positions.find((p) => p.mint === output.mint)!.quantity).toBe(
    15,
  );
  expect(
    swapped.positions.find((p) => p.mint === output.mint)!.costBasisUsd,
  ).toBe(375);
  const [buy, sell] = swapped.orders;
  expect(buy!.side).toBe("buy");
  expect(sell!.side).toBe("sell");
  expect(buy!.swapId).toBe(sell!.swapId);
  expect(buy!.id).not.toBe(sell!.id);
  expect(buy!.totalUsd).toBe(sell!.totalUsd);
  expect(sell!.realizedPnlUsd).toBe(125);
  expect(valuePaperAccount(swapped, [appreciated, output]).profitLossUsd).toBe(
    500,
  );
  expect(valuePaperAccount(swapped, [appreciated, output]).totalUsd).toBe(
    valuePaperAccount(account, [appreciated, output]).totalUsd,
  );
  expect(JSON.stringify(account)).toBe(original);
  expect(parsePaperAccount(JSON.parse(JSON.stringify(swapped)))).toEqual(
    swapped,
  );
});

test("full paper swap merges into an existing output holding and records realized losses", () => {
  let account = executePaperOrder(
    createPaperAccount(1000),
    input,
    "buy",
    200,
    now,
  );
  account = executePaperOrder(account, output, "buy", 100, now);
  const swapped = executePaperSwap(
    account,
    { ...input, priceUsd: 20 },
    output,
    4,
    now,
  );
  expect(swapped.positions.some((p) => p.mint === input.mint)).toBe(false);
  expect(swapped.positions[0]!.quantity).toBe(7.2);
  expect(swapped.positions[0]!.costBasisUsd).toBe(180);
  expect(swapped.cashUsd).toBe(700);
  expect(swapped.orders[1]!.realizedPnlUsd).toBe(-120);
  expect(valuePaperAccount(swapped, [input, output]).profitLossUsd).toBe(-120);
});

test("invalid or insufficient input quantities cannot modify either side or create cash", () => {
  const account = executePaperOrder(
    createPaperAccount(1000),
    input,
    "buy",
    200,
    now,
  );
  const original = JSON.stringify(account);
  for (const quantity of [0, -1, NaN, Infinity, 5, 4 + 1e-12])
    expect(() =>
      executePaperSwap(account, input, output, quantity, now),
    ).toThrow();
  expect(() => executePaperSwap(account, input, input, 1, now)).toThrow(
    /different/,
  );
  expect(() =>
    executePaperSwap(createPaperAccount(), input, output, 1, now),
  ).toThrow(/holdings/);
  expect(JSON.stringify(account)).toBe(original);
});

test("a halted, missing, stale or future quote on either side makes the whole swap fail", () => {
  const account = executePaperOrder(
    createPaperAccount(1000),
    input,
    "buy",
    200,
    now,
  );
  const original = JSON.stringify(account);
  for (const invalid of [
    { priceUsd: null },
    { priceUsd: 0 },
    { priceUsd: Infinity },
    { tradingHalted: true },
    { verified: false },
    { priceObservedAt: "2026-09-12T23:57:59.000Z" },
    { priceObservedAt: "2026-09-13T00:00:31.000Z" },
    { priceObservedAt: null },
  ]) {
    expect(() =>
      executePaperSwap(account, { ...input, ...invalid }, output, 1, now),
    ).toThrow();
    expect(() =>
      executePaperSwap(account, input, { ...output, ...invalid }, 1, now),
    ).toThrow();
  }
  expect(JSON.stringify(account)).toBe(original);
});

test("cash stays bit-for-bit unchanged and small remaining holdings are not discarded", () => {
  const account = {
    ...createPaperAccount(1000),
    cashUsd: 0.1 + 0.2,
    positions: [
      {
        mint: input.mint,
        symbol: input.symbol,
        quantity: 1e-9,
        costBasisUsd: 1e-8,
      },
    ],
  };
  const swapped = executePaperSwap(account, input, output, 9.9e-10, now);
  expect(swapped.cashUsd).toBe(account.cashUsd);
  const remaining = swapped.positions.find((p) => p.mint === input.mint)!;
  expect(remaining.quantity > 0 && remaining.quantity < 1e-10).toBeTruthy();
  expect(remaining.costBasisUsd > 0).toBeTruthy();
});

test("corrupt persisted swap identifiers and realized PnL are rejected", () => {
  const bought = executePaperOrder(
    createPaperAccount(),
    input,
    "buy",
    100,
    now,
  );
  const swapped = executePaperSwap(bought, input, output, 1, now);
  expect(
    parsePaperAccount({
      ...swapped,
      orders: [{ ...swapped.orders[0], swapId: "" }],
    }),
  ).toBe(null);
  expect(
    parsePaperAccount({
      ...swapped,
      orders: [{ ...swapped.orders[1], realizedPnlUsd: Infinity }],
    }),
  ).toBe(null);
  expect(
    parsePaperAccount({
      ...swapped,
      orders: [{ ...swapped.orders[1], realizedPnlUsd: "invalid" }],
    }),
  ).toBe(null);
});
