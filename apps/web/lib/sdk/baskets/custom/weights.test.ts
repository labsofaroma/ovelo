import { describe, expect, test } from "vitest";
import type { MarketAsset } from "../../markets";
import {
  autoBalanceWeights,
  calculateEqualWeights,
  calculateMarketCapWeights,
} from "./weights";
import type { BasketAllocation } from "./types";

const mint = (n: number) => String(n).padStart(32, "1");
const asset = (n: number, weightBps = 0): BasketAllocation => ({
  mint: mint(n),
  symbol: `T${n}`,
  weightBps,
});
const sum = (items: BasketAllocation[]) =>
  items.reduce((total, item) => total + item.weightBps, 0);

describe("calculateEqualWeights", () => {
  test("conserves 10,000 bps and gives the remainder to the first legs", () => {
    const weights = calculateEqualWeights([asset(1), asset(2), asset(3)]);
    expect(weights.map((w) => w.weightBps)).toEqual([3334, 3333, 3333]);
    for (let count = 1; count <= 12; count += 1) {
      const result = calculateEqualWeights(
        Array.from({ length: count }, (_, i) => asset(i)),
      );
      expect(sum(result)).toBe(10_000);
      expect(
        Math.max(...result.map((w) => w.weightBps)) -
          Math.min(...result.map((w) => w.weightBps)),
      ).toBeLessThanOrEqual(1);
    }
  });

  test("rejects zero and more than twelve legs", () => {
    expect(() => calculateEqualWeights([])).toThrow(/between 1 and 12/);
    expect(() =>
      calculateEqualWeights(Array.from({ length: 13 }, (_, i) => asset(i))),
    ).toThrow(/between 1 and 12/);
  });
});

describe("autoBalanceWeights", () => {
  test("empty in, empty out; more than twelve legs is rejected", () => {
    expect(autoBalanceWeights([])).toEqual([]);
    expect(() =>
      autoBalanceWeights(Array.from({ length: 13 }, (_, i) => asset(i, 100))),
    ).toThrow(/between 1 and 12/);
  });

  test("all-zero or non-finite weights fall back to equal weights", () => {
    expect(
      autoBalanceWeights([asset(1), asset(2)]).map((w) => w.weightBps),
    ).toEqual([5000, 5000]);
    expect(
      autoBalanceWeights([
        asset(1, Number.NaN),
        asset(2, -5),
        asset(3, Number.POSITIVE_INFINITY),
      ]).map((w) => w.weightBps),
    ).toEqual([3334, 3333, 3333]);
  });

  test("an under-allocated basket spreads the remainder over zero-weight legs only", () => {
    const result = autoBalanceWeights([
      asset(1, 6000),
      asset(2, 0),
      asset(3, 0),
    ]);
    expect(result.map((w) => w.weightBps)).toEqual([6000, 2000, 2000]);
    expect(
      sum(
        autoBalanceWeights([
          asset(1, 5000),
          asset(2, 0),
          asset(3, 0),
          asset(4, 0),
        ]),
      ),
    ).toBe(10_000);
  });

  test("scales proportionally to exactly 10,000 and never leaves a leg at zero", () => {
    const result = autoBalanceWeights([asset(1, 1), asset(2, 1), asset(3, 1)]);
    expect(sum(result)).toBe(10_000);
    expect(result.every((w) => w.weightBps >= 1)).toBe(true);
    const skewed = autoBalanceWeights([
      asset(1, 9_999),
      asset(2, 9_999),
      asset(3, 1),
    ]);
    expect(sum(skewed)).toBe(10_000);
    expect(skewed.every((w) => w.weightBps >= 1)).toBe(true);
  });

  test("always conserves 10,000 bps across many pseudo-random inputs", () => {
    let seed = 42;
    const next = () =>
      (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) % 20_000;
    for (let round = 0; round < 300; round += 1) {
      const legs = 2 + (round % 11);
      const input = Array.from({ length: legs }, (_, i) => asset(i, next()));
      const result = autoBalanceWeights(input);
      expect(sum(result), JSON.stringify(input.map((a) => a.weightBps))).toBe(
        10_000,
      );
      expect(result.every((w) => w.weightBps >= 1)).toBe(true);
    }
  });

  test("keeps names and mints and does not mutate the input", () => {
    const input = [{ ...asset(1, 3), name: "One" }, asset(2, 1)];
    const snapshot = JSON.stringify(input);
    const result = autoBalanceWeights(input);
    expect(result[0]).toMatchObject({
      mint: mint(1),
      symbol: "T1",
      name: "One",
    });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("calculateMarketCapWeights", () => {
  const catalog = (
    caps: Record<number, number | null | { underlying: number }>,
  ): MarketAsset[] =>
    Object.entries(caps).map(([n, cap]) => ({
      mint: mint(Number(n)),
      symbol: `T${n}`,
      marketCapUsd: typeof cap === "number" ? cap : null,
      underlyingMarketCapUsd:
        typeof cap === "object" && cap ? cap.underlying : null,
    })) as unknown as MarketAsset[];

  test("weights by market cap, preferring the underlying cap, conserving 10,000 bps", () => {
    const result = calculateMarketCapWeights(
      [asset(1), asset(2), asset(3)],
      catalog({ 1: 1_000, 2: { underlying: 2_000 }, 3: 1_000 }),
    );
    expect(result.map((w) => w.weightBps)).toEqual([2500, 5000, 2500]);
    expect(sum(result)).toBe(10_000);
  });

  test("distributes rounding remainders deterministically", () => {
    const result = calculateMarketCapWeights(
      [asset(1), asset(2), asset(3)],
      catalog({ 1: 1, 2: 1, 3: 1 }),
    );
    expect(result.map((w) => w.weightBps)).toEqual([3334, 3333, 3333]);
  });

  test("fails honestly when a cap is missing, below one dollar, or a weight would round to zero", () => {
    expect(() =>
      calculateMarketCapWeights(
        [asset(1), asset(2)],
        catalog({ 1: 5, 2: null }),
      ),
    ).toThrow(/Market cap is unavailable for T2/);
    expect(() =>
      calculateMarketCapWeights(
        [asset(1), asset(2)],
        catalog({ 1: 5, 2: 0.4 }),
      ),
    ).toThrow(/unavailable/);
    expect(() =>
      calculateMarketCapWeights([asset(1), asset(9)], catalog({ 1: 5 })),
    ).toThrow(/unavailable for T9/);
    expect(() =>
      calculateMarketCapWeights(
        [asset(1), asset(2)],
        catalog({ 1: 1_000_000_000, 2: 1 }),
      ),
    ).toThrow(/too small/);
    expect(() => calculateMarketCapWeights([], [])).toThrow(/between 1 and 12/);
  });
});
