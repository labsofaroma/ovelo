import { expect, test } from "vitest";
import { allocateBasketInput } from "./atomic-swap";
import {
  calculateBasketRebalance,
  calculateTimeWeightedReturn,
} from "./rebalance";

test("basket allocations conserve every unit with deterministic remainders", () => {
  const targets = [
    { mint: "a", weightBps: 3333 },
    { mint: "b", weightBps: 3333 },
    { mint: "c", weightBps: 3334 },
  ];
  for (let amount = 3n; amount <= 1000n; amount++) {
    const allocated = allocateBasketInput(amount, targets);
    expect(allocated.reduce((sum, leg) => sum + leg.amount, 0n)).toBe(amount);
    expect(allocated.every((leg) => leg.amount > 0n)).toBeTruthy();
  }
  expect(allocateBasketInput(10n, targets).map((x) => x.amount)).toEqual([
    3n,
    3n,
    4n,
  ]);
  expect(() => allocateBasketInput(2n, targets)).toThrow(/too small/);
  expect(() =>
    allocateBasketInput(10n, [
      { mint: "a", weightBps: 5000 },
      { mint: "a", weightBps: 5000 },
    ]),
  ).toThrow(/unique/);
});
test("rebalance keeps cash and asset value conserved without token float rounding", () => {
  const result = calculateBasketRebalance({
    targets: [
      { mint: "a", weightBps: 6000 },
      { mint: "b", weightBps: 4000 },
    ],
    holdings: [
      { mint: "a", valueUsdMicros: 80n },
      { mint: "b", valueUsdMicros: 10n },
    ],
    cashUsdMicros: 10n,
  });
  expect(result.legs.map((x) => x.deltaValueUsdMicros)).toEqual([-20n, 30n]);
  expect(result.legs.map((x) => x.action)).toEqual(["sell", "buy"]);
  expect(result.legs.reduce((sum, x) => sum + x.deltaValueUsdMicros, 0n)).toBe(
    10n,
  );
  expect(() =>
    calculateBasketRebalance({
      targets: [{ mint: "a", weightBps: 10000 }],
      holdings: [{ mint: "unrelated", valueUsdMicros: 1n }],
    }),
  ).toThrow(/explicitly/);
  const unfunded = calculateBasketRebalance({
    targets: [
      { mint: "a", weightBps: 5000 },
      { mint: "b", weightBps: 5000 },
    ],
    holdings: [
      { mint: "a", valueUsdMicros: 51n },
      { mint: "b", valueUsdMicros: 40n },
    ],
    cashUsdMicros: 9n,
    thresholdBps: 200,
  });
  expect(unfunded.fullyFunded).toBe(false);
  expect(unfunded.projectedCashUsdMicros).toBe(-1n);
  expect(calculateTimeWeightedReturn([])).toBe(null);
  expect(
    Math.abs(
      calculateTimeWeightedReturn([
        { openingValue: 100, closingValue: 110 },
        { openingValue: 200, closingValue: 220 },
      ]) - 0.21,
    ) < 1e-10,
  ).toBeTruthy();
});
