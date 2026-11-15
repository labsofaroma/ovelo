import { describe, expect, test } from "vitest";
import { NO_PERIOD } from "./constants";
import {
  bpsOf,
  delegationTerms,
  expectedOut,
  legAmounts,
  minOut,
  multiplierFpCeil,
  runnablePeriod,
  scheduleIndex,
  UNIT_MULTIPLIER_FP,
} from "./schedule";

/** The same vectors as `programs/ovelo_guard/src/math_tests.rs`. */
describe("schedule mirror", () => {
  test("schedule index", () => {
    expect(scheduleIndex(99n, 100n, 10n)).toBeNull();
    expect(scheduleIndex(100n, 100n, 10n)).toBe(0n);
    expect(scheduleIndex(110n, 100n, 10n)).toBe(1n);
    expect(scheduleIndex(100n, 100n, 0n)).toBeNull();
  });

  test("oldest runnable period, catch-up and skip", () => {
    expect(runnablePeriod(NO_PERIOD, 4, 1, 0n)).toEqual({
      period: 0,
      newlySkipped: 0,
    });
    expect(runnablePeriod(0, 4, 1, 0n)).toBeNull();
    expect(runnablePeriod(0, 4, 1, 2n)).toEqual({ period: 1, newlySkipped: 0 });
    expect(runnablePeriod(0, 5, 1, 3n)).toEqual({ period: 2, newlySkipped: 1 });
    expect(runnablePeriod(NO_PERIOD, 5, 0, 3n)).toEqual({
      period: 3,
      newlySkipped: 3,
    });
    expect(runnablePeriod(3, 4, 1, 9n)).toBeNull();
    expect(runnablePeriod(1, 4, 1, 9n)).toBeNull();
    expect(runnablePeriod(2, 4, 1, 4n)).toEqual({ period: 3, newlySkipped: 0 });
  });

  test("delegation terms, leg split, fees and the slippage floor", () => {
    expect(delegationTerms(100n, 1, 86_400n, 1_000n)).toEqual({
      amountPerPeriod: 200n,
      expiry: 87_400n,
    });
    expect(legAmounts(100n, [3_333, 3_333, 3_334])).toEqual([33n, 33n, 34n]);
    expect(legAmounts(9_999n, [1, 9_999])).toEqual([0n, 9_999n]);
    expect(bpsOf(1_000_000n, 25)).toBe(2_500n);
    expect(minOut(1_000_000n, 300)).toBe(970_000n);
    expect(minOut(999n, 1)).toBe(998n);
  });

  test("oracle amount with decimals and the scaled multiplier, rounding down", () => {
    const base = {
      fundingDecimals: 6,
      price: 20_000_000n,
      expo: -5,
      multiplierFp: UNIT_MULTIPLIER_FP,
    };
    expect(
      expectedOut({ ...base, amountIn: 100_000_000n, outputDecimals: 8 }),
    ).toBe(50_000_000n);
    expect(
      expectedOut({ ...base, amountIn: 100_000_000n, outputDecimals: 6 }),
    ).toBe(500_000n);
    expect(
      expectedOut({
        ...base,
        amountIn: 1_000_000n,
        outputDecimals: 6,
        price: 300_000n,
      }),
    ).toBe(333_333n);
    expect(
      expectedOut({
        ...base,
        amountIn: 1_000_000n,
        outputDecimals: 6,
        price: 3n,
        expo: 5,
      }),
    ).toBe(3n);
    expect(
      expectedOut({
        ...base,
        amountIn: 1_000_000n,
        outputDecimals: 0,
        fundingDecimals: 20,
      }),
    ).toBe(0n);
    const m = multiplierFpCeil(1.0038023030588032);
    expect(m).toBe(1_003_802_303_059n);
    expect(
      expectedOut({
        ...base,
        amountIn: 100_000_000n,
        outputDecimals: 8,
        multiplierFp: m,
      }),
    ).toBe(49_810_604n);
    expect(() =>
      expectedOut({ ...base, amountIn: 1n, outputDecimals: 6, price: 0n }),
    ).toThrow(/positive/);
    expect(() =>
      expectedOut({
        ...base,
        amountIn: 1n,
        outputDecimals: 6,
        multiplierFp: 0n,
      }),
    ).toThrow(/positive/);
  });

  test("multiplier conversion is exact and rounds up", () => {
    expect(multiplierFpCeil(1)).toBe(UNIT_MULTIPLIER_FP);
    expect(multiplierFpCeil(2.5)).toBe(2_500_000_000_000n);
    expect(multiplierFpCeil(0.1)).toBe(100_000_000_001n);
    expect(multiplierFpCeil(1024)).toBe(1_024_000_000_000_000n);
    for (const bad of [0, -1, Infinity, NaN])
      expect(() => multiplierFpCeil(bad)).toThrow(/Invalid/);
  });
});
