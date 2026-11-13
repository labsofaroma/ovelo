import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocationBps, sumFixed, valueOf } from "./valuation";

describe("portfolio valuation (bigint, property-tested)", () => {
  it("values exactly: 1.5 tokens (6 dp) at $200.25 is $300.375", () => {
    expect(valueOf("1500000", 6, { raw: "20025", decimals: 2 })).toEqual({
      raw: "30037",
      decimals: 2,
    });
    expect(valueOf("1500000", 6, { raw: "200250000", decimals: 6 })).toEqual({
      raw: "300375000",
      decimals: 6,
    });
  });

  it("an unpriced, zero-priced or malformed amount is null, never an estimate", () => {
    expect(valueOf("1", 6, null)).toBeNull();
    expect(valueOf("1", 6, { raw: "0", decimals: 2 })).toBeNull();
    expect(valueOf("1.5", 6, { raw: "1", decimals: 2 })).toBeNull();
  });

  it("valuation equals the exact rational value, truncated (never rounded up)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
        fc.integer({ min: 0, max: 18 }),
        fc.bigInt({ min: 1n, max: 10n ** 15n }),
        fc.integer({ min: 0, max: 12 }),
        (amount, tokenDecimals, priceRaw, priceDecimals) => {
          const value = valueOf(amount.toString(), tokenDecimals, {
            raw: priceRaw.toString(),
            decimals: priceDecimals,
          })!;
          const exactNumerator = amount * priceRaw;
          const denominator = 10n ** BigInt(tokenDecimals);
          expect(BigInt(value.raw) * denominator <= exactNumerator).toBe(true);
          expect((BigInt(value.raw) + 1n) * denominator > exactNumerator).toBe(
            true,
          );
        },
      ),
    );
  });

  it("sums conserve every unit across mixed decimals", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            raw: fc.bigInt({ min: 0n, max: 10n ** 20n }),
            decimals: fc.integer({ min: 0, max: 12 }),
          }),
          { maxLength: 20 },
        ),
        (items) => {
          const total = sumFixed(
            items.map((i) => ({ raw: i.raw.toString(), decimals: i.decimals })),
          );
          const expected = items.reduce(
            (sum, i) =>
              sum + i.raw * 10n ** BigInt(total.decimals - i.decimals),
            0n,
          );
          expect(BigInt(total.raw)).toBe(expected);
        },
      ),
    );
  });

  it("allocations never exceed 10,000 bps in total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 15n }), {
          minLength: 1,
          maxLength: 12,
        }),
        (raws) => {
          const values = raws.map((r) => ({ raw: r.toString(), decimals: 2 }));
          const total = sumFixed(values);
          const sum = values.reduce((s, v) => s + allocationBps(v, total), 0);
          expect(sum).toBeLessThanOrEqual(10_000);
        },
      ),
    );
  });
});
