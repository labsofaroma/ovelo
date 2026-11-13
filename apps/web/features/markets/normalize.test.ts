import { describe, expect, it } from "vitest";
import { asset, iso, snapshot } from "../test/fixtures";
import { toMarketRow, toMarketsView } from "./normalize";

describe("toMarketRow", () => {
  it("keeps price, its source and its time together", () => {
    const row = toMarketRow(asset());
    expect(row.price).toEqual({ raw: "101250000", decimals: 6 });
    expect(row.priceSource).toBe("jupiter-tokens-v2");
    expect(row.priceObservedAt).toBe(iso());
    expect(row.change24h).toEqual({ raw: "15000", decimals: 4 });
  });
  it("drops the timestamp and source when there is no price (missing data)", () => {
    const row = toMarketRow(asset({ priceUsd: null }));
    expect(row.price).toBeNull();
    expect(row.priceObservedAt).toBeNull();
    expect(row.priceSource).toBeNull();
  });
  it("treats a zero price as no price", () => {
    expect(toMarketRow(asset({ priceUsd: 0 })).price).toBeNull();
  });
  it("keeps the underlying reference separate from the token price", () => {
    const row = toMarketRow(
      asset({
        priceUsd: null,
        underlyingPriceUsd: 42,
        underlyingPriceSource: "pyth",
      }),
    );
    expect(row.price).toBeNull();
    expect(row.reference?.price).toEqual({ raw: "42000000", decimals: 6 });
    expect(row.reference?.source).toBe("pyth");
  });
});

describe("toMarketsView", () => {
  it("normalises rows, baskets (integer bps) and pulse", () => {
    const view = toMarketsView(snapshot());
    expect(view.rows).toHaveLength(3);
    expect(view.baskets[0]?.members.map((m) => m.weightBps)).toEqual([
      5_000, 5_000,
    ]);
    expect(view.pulse.totalAssets).toBe(3);
    expect(view.pulse.pricedAssets).toBe(2);
  });
  it("keeps partial status and provider warnings", () => {
    const view = toMarketsView(
      snapshot({
        status: "partial",
        warnings: ["PreStocks catalog could not be loaded."],
      }),
    );
    expect(view.status).toBe("partial");
    expect(view.warnings).toEqual(["PreStocks catalog could not be loaded."]);
  });
  it("throws on an unavailable or empty snapshot so it is never cached", () => {
    expect(() => toMarketsView(snapshot({ status: "unavailable" }))).toThrow();
    expect(() => toMarketsView(snapshot({ assets: [] }))).toThrow();
  });
});
