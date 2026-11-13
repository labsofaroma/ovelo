import { describe, expect, test } from "vitest";
import { fromTokenAmount, toTokenAmount } from "./amounts";

describe("toTokenAmount", () => {
  test("preserves exact units beyond Number.MAX_SAFE_INTEGER", () => {
    expect(toTokenAmount("9007199254.740993", 6)).toBe("9007199254740993");
    expect(toTokenAmount("18446744073709.551615", 6)).toBe(
      "18446744073709551615",
    );
  });

  test("handles whole numbers, short fractions and zero-decimal tokens", () => {
    expect(toTokenAmount("1", 6)).toBe("1000000");
    expect(toTokenAmount("0.5", 6)).toBe("500000");
    expect(toTokenAmount(" 2.50 ", 2)).toBe("250");
    expect(toTokenAmount("7", 0)).toBe("7");
    expect(toTokenAmount("0.000001", 6)).toBe("1");
    expect(toTokenAmount("1", 18)).toBe("1000000000000000000");
  });

  test.each([
    "0",
    "0.0",
    "-1",
    "+1",
    "1e6",
    "NaN",
    "Infinity",
    "",
    " ",
    "1.",
    ".5",
    "01",
    "1,5",
    "0x10",
    "1 000",
  ])("rejects %j", (value) => {
    expect(() => toTokenAmount(value, 6)).toThrow();
  });

  test("rejects too many fraction digits, naming the limit", () => {
    expect(() => toTokenAmount("0.0000001", 6)).toThrow(
      /up to 6 decimal places/,
    );
    expect(() => toTokenAmount("1.5", 0)).toThrow(/up to 0 decimal places/);
  });

  test("rejects values above u64", () => {
    expect(() => toTokenAmount("18446744073709551616", 0)).toThrow(
      /outside the supported range/,
    );
    expect(() => toTokenAmount("18446744073709.551616", 6)).toThrow(
      /outside the supported range/,
    );
  });

  test.each([-1, 1.5, 19, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects decimals %s",
    (decimals) => {
      expect(() => toTokenAmount("1", decimals)).toThrow(/precision/);
    },
  );
});

describe("fromTokenAmount", () => {
  test("formats raw units and trims trailing zeros", () => {
    expect(fromTokenAmount("9007199254740993", 6)).toBe("9007199254.740993");
    expect(fromTokenAmount("1000000", 6)).toBe("1");
    expect(fromTokenAmount("1500000", 6)).toBe("1.5");
    expect(fromTokenAmount("0", 6)).toBe("0");
    expect(fromTokenAmount("1", 6)).toBe("0.000001");
    expect(fromTokenAmount("100", 2)).toBe("1");
    expect(fromTokenAmount("10000", 2)).toBe("100");
  });

  test("zero decimals returns the integer untouched", () => {
    expect(fromTokenAmount("123", 0)).toBe("123");
  });

  test("is exact for amounts far beyond u64", () => {
    expect(fromTokenAmount("123456789012345678901234567890", 18)).toBe(
      "123456789012.34567890123456789",
    );
  });

  test.each(["-1", "1.5", "1e3", "", " 1", "abc"])(
    "rejects raw amount %j",
    (raw) => {
      expect(() => fromTokenAmount(raw, 6)).toThrow(/Invalid token amount/);
    },
  );

  test.each([-1, 256, 1.5])("rejects decimals %s", (decimals) => {
    expect(() => fromTokenAmount("1", decimals)).toThrow(
      /Invalid token amount/,
    );
  });
});

describe("round trip", () => {
  test.each([
    ["1", 6],
    ["0.000001", 6],
    ["12345.6789", 4],
    ["9007199254.740993", 6],
    ["3", 0],
  ] as const)("%s at %i decimals", (human, decimals) => {
    expect(fromTokenAmount(toTokenAmount(human, decimals), decimals)).toBe(
      human,
    );
  });
});
