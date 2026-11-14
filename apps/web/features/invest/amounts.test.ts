import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  explorerUrl,
  oraclePriceText,
  parseDecimalToRaw,
  rawToDecimal,
  toBase64,
} from "./amounts";

describe("exact amounts", () => {
  it("property: raw → decimal text → raw round-trips exactly, never through a float", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
        fc.integer({ min: 0, max: 9 }),
        (raw, decimals) => {
          const text = rawToDecimal(raw, decimals);
          expect(text).not.toMatch(/e/i);
          expect(parseDecimalToRaw(text, decimals)).toBe(raw);
          expect(typeof parseDecimalToRaw(text, decimals)).toBe("bigint");
        },
      ),
      { numRuns: 500 },
    );
  });

  it("parses decimals exactly and refuses what a float would accept", () => {
    expect(parseDecimalToRaw("12.5", 6)).toBe(12_500_000n);
    expect(parseDecimalToRaw("0.1", 6)).toBe(100_000n);
    expect(parseDecimalToRaw("1,000", 6)).toBe(1_000_000_000n);
    expect(parseDecimalToRaw("10.", 6)).toBe(10_000_000n);
    expect(parseDecimalToRaw("0.0000001", 6)).toBeNull();
    for (const bad of ["", "-1", "1e3", "abc", "1.2.3", " . "])
      expect(parseDecimalToRaw(bad, 6)).toBeNull();
  });

  it("renders oracle prices exactly from price and exponent", () => {
    expect(oraclePriceText("23142000000", -8)).toBe("231.42");
    expect(oraclePriceText("5", -8)).toBe("0.00000005");
    expect(oraclePriceText("100000000", -8)).toBe("1");
    expect(oraclePriceText("12", 2)).toBe("1200");
    expect(oraclePriceText("-150", -2)).toBe("-1.5");
  });

  it("explorer links and base64", () => {
    expect(explorerUrl("abc", "devnet", "x")).toBe(
      "https://explorer.solana.com/tx/abc?cluster=devnet",
    );
    expect(explorerUrl("abc", "localnet", "http://127.0.0.1:8899")).toBe(
      "https://explorer.solana.com/tx/abc?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899",
    );
    expect(toBase64(new Uint8Array([1, 2, 255]))).toBe("AQL/");
  });
});
