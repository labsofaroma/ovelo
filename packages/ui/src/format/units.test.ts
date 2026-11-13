import { describe, expect, it } from "vitest";
import { formatSignedUnits, formatUnits } from "./units";

describe("formatUnits", () => {
  it("formats raw integers with fixed digits and grouping", () => {
    expect(formatUnits(123_456_789n, 6)).toEqual({ text: "123.46", sign: 1 });
    expect(formatUnits(1_234_567_890_000n, 6, { fractionDigits: 2 }).text).toBe(
      "1,234,567.89",
    );
    expect(formatUnits(5n, 0, { fractionDigits: 0 }).text).toBe("5");
    expect(
      formatUnits(1_000_000n, 6, { grouping: false, fractionDigits: 6 }).text,
    ).toBe("1.000000");
  });

  it("rounds half away from zero, symmetrically", () => {
    expect(formatUnits(125n, 2, { fractionDigits: 1 }).text).toBe("1.3");
    expect(formatUnits(-125n, 2, { fractionDigits: 1 })).toEqual({
      text: "1.3",
      sign: -1,
    });
    expect(formatUnits(124n, 2, { fractionDigits: 1 }).text).toBe("1.2");
    expect(formatUnits(999n, 3, { fractionDigits: 2 }).text).toBe("1.00");
  });

  it("never produces negative zero: a tiny negative rounds to sign 0 and no minus", () => {
    expect(formatUnits(-1n, 6)).toEqual({ text: "0.00", sign: 0 });
    expect(formatSignedUnits(-1n, 6).signed).toBe("0.00");
    expect(formatSignedUnits(0n, 2).signed).toBe("0.00");
  });

  it("pads when asked for more digits than the unit has", () => {
    expect(formatUnits(7n, 0, { fractionDigits: 2 }).text).toBe("7.00");
    expect(formatUnits(15n, 1, { fractionDigits: 3 }).text).toBe("1.500");
  });

  it("is exact far beyond Number.MAX_SAFE_INTEGER (no float math)", () => {
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    expect(formatUnits(huge, 18, { fractionDigits: 4 }).text).toBe(
      "123,456,789,012.3457",
    );
    expect(formatUnits(-huge, 0, { fractionDigits: 0 }).text).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
    expect(
      formatUnits(9_007_199_254_740_993n, 0, { fractionDigits: 0 }).text,
    ).toBe("9,007,199,254,740,993");
  });

  it("handles very small values and 18-decimal tokens", () => {
    expect(formatUnits(1n, 18, { fractionDigits: 18 }).text).toBe(
      "0.000000000000000001",
    );
    expect(formatUnits(1n, 18)).toEqual({ text: "0.00", sign: 0 });
    expect(
      formatUnits(5_000_000_000_000_000n, 18, { fractionDigits: 2 }).text,
    ).toBe("0.01");
  });

  it("signs explicitly with a typographic minus", () => {
    expect(formatSignedUnits(123n, 2).signed).toBe("+1.23");
    expect(formatSignedUnits(-123n, 2).signed).toBe("−1.23");
  });

  it("rejects invalid decimals and digit counts", () => {
    expect(() => formatUnits(1n, -1)).toThrow(RangeError);
    expect(() => formatUnits(1n, 1.5)).toThrow(RangeError);
    expect(() => formatUnits(1n, 37)).toThrow(RangeError);
    expect(() => formatUnits(1n, 2, { fractionDigits: -1 })).toThrow(
      RangeError,
    );
  });
});
