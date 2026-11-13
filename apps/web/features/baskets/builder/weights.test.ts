import { describe, expect, it } from "vitest";
import {
  bpsToPercentText,
  clampBps,
  equalWeights,
  normalizeWeights,
  parsePercent,
} from "./weights";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe("equalWeights", () => {
  it("sums to exactly 10,000 for every count from 1 to 12, remainder on the first rows", () => {
    for (let n = 1; n <= 12; n += 1) {
      const weights = equalWeights(n);
      expect(sum(weights)).toBe(10_000);
      expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(
        1,
      );
      expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    }
    expect(equalWeights(3)).toEqual([3334, 3333, 3333]);
    expect(equalWeights(7)).toEqual([1429, 1429, 1429, 1429, 1428, 1428, 1428]);
    expect(equalWeights(0)).toEqual([]);
    expect(() => equalWeights(-1)).toThrow(RangeError);
  });
});

describe("normalizeWeights", () => {
  it("scales proportionally to exactly 10,000 with largest-remainder rounding", () => {
    expect(normalizeWeights([1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(normalizeWeights([2000, 2000])).toEqual([5000, 5000]);
    expect(normalizeWeights([1, 2])).toEqual([3333, 6667]);
    expect(normalizeWeights([5000, 5000, 5000])).toEqual([3334, 3333, 3333]);
  });

  it("breaks remainder ties toward the earlier row, deterministically", () => {
    expect(normalizeWeights([1, 1, 1, 1, 1, 1])).toEqual([
      1667, 1667, 1667, 1667, 1666, 1666,
    ]);
    expect(normalizeWeights([3, 3, 3])).toEqual(normalizeWeights([3, 3, 3]));
  });

  it("keeps zeros at zero, turns all-zero into equal weights, and leaves 10,000 alone", () => {
    expect(normalizeWeights([0, 1, 3])).toEqual([0, 2500, 7500]);
    expect(normalizeWeights([0, 0])).toEqual([5000, 5000]);
    expect(normalizeWeights([1234, 8766])).toEqual([1234, 8766]);
    expect(normalizeWeights([])).toEqual([]);
  });

  it("always sums to 10,000 on many generated inputs", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let run = 0; run < 500; run += 1) {
      const n = 1 + (next() % 12);
      const input = Array.from({ length: n }, () => next() % 20_000);
      const output = normalizeWeights(input);
      expect(sum(output)).toBe(10_000);
      expect(output.every((w) => Number.isInteger(w) && w >= 0)).toBe(true);
    }
  });

  it("refuses negative and fractional input", () => {
    expect(() => normalizeWeights([-1, 2])).toThrow(RangeError);
    expect(() => normalizeWeights([0.5, 2])).toThrow(RangeError);
  });
});

describe("percent text", () => {
  it.each([
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    ["12,34", 1234],
    [" 7.5 % ", 750],
    ["0", 0],
    ["100", 10_000],
    ["100.00", 10_000],
    ["0.01", 1],
    ["5.", 500],
  ])("parses %j as %i bps", (text, bps) => {
    expect(parsePercent(text)).toBe(bps);
  });

  it.each(["", "abc", "-1", "100.01", "12.345", "1e2", "1000", ".5"])(
    "refuses %j",
    (text) => {
      expect(parsePercent(text)).toBeNull();
    },
  );

  it("formats and clamps", () => {
    expect(bpsToPercentText(3334)).toBe("33.34");
    expect(bpsToPercentText(5)).toBe("0.05");
    expect(bpsToPercentText(10_000)).toBe("100.00");
    expect(clampBps(-3)).toBe(0);
    expect(clampBps(10_400)).toBe(10_000);
  });
});
