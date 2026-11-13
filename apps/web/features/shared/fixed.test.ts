import { describe, expect, it } from "vitest";
import {
  changeProp,
  fixedFromNumber,
  fixedSchema,
  formatBps,
  formatCompactUsd,
  formatPercent,
  formatUnitsText,
  formatUsd,
  isPositive,
} from "./fixed";

describe("fixedFromNumber", () => {
  it("converts at the boundary to raw integer + decimals", () => {
    expect(fixedFromNumber(1.5, 6)).toEqual({ raw: "1500000", decimals: 6 });
    expect(fixedFromNumber(0.000123, 6)).toEqual({ raw: "123", decimals: 6 });
    expect(fixedFromNumber(-3.25, 4)).toEqual({ raw: "-32500", decimals: 4 });
  });
  it("never produces negative zero", () => {
    expect(fixedFromNumber(-0.00001, 2)).toEqual({ raw: "0", decimals: 2 });
  });
  it("rejects missing and non-finite values instead of inventing a number", () => {
    for (const value of [
      null,
      undefined,
      Number.NaN,
      Infinity,
      -Infinity,
      1e21,
    ])
      expect(fixedFromNumber(value, 2)).toBeNull();
  });
  it("output always satisfies the schema", () => {
    for (const value of [0, 1, 123.456, -9.99, 1e15])
      expect(fixedSchema.safeParse(fixedFromNumber(value, 6)).success).toBe(
        true,
      );
  });
});

describe("formatting (display only, via @aroma/ui/format)", () => {
  it("formats USD with grouping and keeps sub-dollar precision", () => {
    expect(formatUsd({ raw: "1234560000", decimals: 6 })).toBe("$1,234.56");
    expect(formatUsd({ raw: "1234", decimals: 6 })).toBe("$0.001234");
  });
  it("compacts large figures with exact integer scaling", () => {
    expect(formatCompactUsd({ raw: "123456789000", decimals: 2 })).toBe(
      "$1.23B",
    );
    expect(formatCompactUsd({ raw: "250000000", decimals: 2 })).toBe("$2.50M");
    expect(formatCompactUsd({ raw: "99900", decimals: 2 })).toBe("$999.00");
  });
  it("signs percents with a typographic minus", () => {
    expect(formatPercent({ raw: "15000", decimals: 4 })).toBe("+1.50%");
    expect(formatPercent({ raw: "-32500", decimals: 4 })).toBe("−3.25%");
    expect(formatUnitsText({ raw: "-4200", decimals: 4 }, 2)).toBe("−0.42");
  });
  it("formats basis points", () => {
    expect(formatBps(3334)).toBe("33.34%");
    expect(formatBps(10_000)).toBe("100.00%");
  });
  it("isPositive treats zero and null as no value", () => {
    expect(isPositive({ raw: "0", decimals: 2 })).toBe(false);
    expect(isPositive(null)).toBe(false);
    expect(isPositive({ raw: "1", decimals: 2 })).toBe(true);
  });
  it("changeProp feeds the Change component a bigint", () => {
    expect(changeProp({ raw: "-5", decimals: 1 })).toEqual({
      value: -5n,
      decimals: 1,
    });
    expect(changeProp(null)).toBeNull();
  });
});
