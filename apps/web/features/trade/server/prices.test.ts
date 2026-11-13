import { describe, expect, it } from "vitest";
import { mint } from "../../test/fixtures";
import { freshPrices, pricesQuerySchema } from "./prices";

describe("freshPrices", () => {
  it("returns observed prices with source and time; omits missing ones", async () => {
    const out = await freshPrices(
      [mint(1), mint(2)],
      { getPrices: async () => ({ [mint(1)]: 101.25 }) },
      () => 0,
    );
    expect(out).toEqual({
      source: "Jupiter Price V3",
      observedAt: new Date(0).toISOString(),
      prices: [{ mint: mint(1), price: { raw: "10125000000", decimals: 8 } }],
    });
  });
  it("retries once after a 429, then reports what was observed", async () => {
    let calls = 0;
    const out = await freshPrices(
      [mint(1)],
      {
        getPrices: async () => {
          calls++;
          if (calls === 1)
            throw Object.assign(new Error("429"), { statusCode: 429 });
          return { [mint(1)]: 2 };
        },
      },
      () => 0,
    );
    expect(calls).toBe(2);
    expect(out.prices).toHaveLength(1);
  });
  it("an upstream failure is UPSTREAM_UNAVAILABLE", async () => {
    await expect(
      freshPrices([mint(1)], {
        getPrices: async () => {
          throw new Error("down");
        },
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
  it("accepts 1..12 base58 mints only", () => {
    expect(pricesQuerySchema.safeParse(mint(1)).success).toBe(true);
    expect(pricesQuerySchema.safeParse("").success).toBe(false);
    expect(pricesQuerySchema.safeParse("0xdead").success).toBe(false);
    expect(
      pricesQuerySchema.safeParse(
        Array.from({ length: 13 }, (_, i) => mint(i + 1)).join(","),
      ).success,
    ).toBe(false);
  });
});
