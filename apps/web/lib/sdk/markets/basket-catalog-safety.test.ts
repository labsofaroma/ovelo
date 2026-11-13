import { expect, test } from "vitest";
import {
  CANONICAL_BASKET_DEFINITIONS,
  resolveAllMarketBaskets,
  resolveCanonicalBasket,
  type MarketAsset,
} from "./index";
import { getBasketLiquidityAudit } from "../baskets/liquidity-audit";
const definition = CANONICAL_BASKET_DEFINITIONS.find(
  (item) => item.id === "sol-digital-economy",
)!;
const asset = (symbol: string, index: number): MarketAsset => ({
  mint: `test-only-${index}`,
  symbol: `${symbol}x`,
  underlyingSymbol: symbol,
  name: symbol,
  issuer: "xstocks",
  kind: "equity",
  verified: true,
  tradingHalted: false,
  priceUsd: 10,
  change24hPct: null,
  decimals: 8,
  logoUrl: null,
  volume24hUsd: null,
  liquidityUsd: null,
  marketCapUsd: null,
  updatedAt: null,
  priceObservedAt: null,
  sourceUrl: "https://api.xstocks.fi",
});
test("expanded allocation keeps exact weights without inventing liquidity or prices", () => {
  const assets = definition.symbols.map(asset);
  const basket = resolveAllMarketBaskets(assets).find(
    (item) => item.id === definition.id,
  )!;
  expect(basket.assets.length).toBe(12);
  expect(basket.assets.reduce((sum, item) => sum + item.weight, 0)).toBe(10000);
  expect(basket.available).toBe(true);
  expect(basket.liquidityAudit).toBe(undefined);
  for (const patch of [
    { verified: false },
    { tradingHalted: true },
    { priceUsd: null },
  ]) {
    const degraded = assets.map((value, index) =>
      index === 0 ? { ...value, ...patch } : value,
    );
    expect(
      resolveAllMarketBaskets(degraded).find(
        (item) => item.id === definition.id,
      )!.available,
    ).toBe(false);
  }
  expect(
    resolveAllMarketBaskets(assets.slice(1)).find(
      (item) => item.id === definition.id,
    )!.available,
  ).toBe(false);
});
test("research-only canonical symbols never masquerade as verified tradable mints", () => {
  const basket = resolveCanonicalBasket(definition.id)!;
  expect(basket.available).toBe(false);
  expect(basket.missingSymbols.length).toBe(12);
  expect(
    basket.assets.every(
      ({ asset }) =>
        !asset.verified && asset.priceUsd === null && asset.decimals === null,
    ),
  ).toBeTruthy();
});

test("an unaudited definition has no invented verification record", () => {
  expect(getBasketLiquidityAudit("sol-digital-economy")).toBe(null);
});
