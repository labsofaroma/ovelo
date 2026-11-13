import type { MarketAsset } from "../types";

export function baseAsset(
  mint: string,
  symbol: string,
  name: string,
  issuer: MarketAsset["issuer"],
  sourceUrl: string,
): MarketAsset {
  return {
    mint,
    symbol,
    name,
    issuer,
    sourceUrl,
    decimals: null,
    kind: issuer === "prestocks" ? "pre-ipo" : "unknown",
    logoUrl: null,
    priceUsd: null,
    change24hPct: null,
    volume24hUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    updatedAt: null,
    priceObservedAt: null,
    priceSource: null,
    priceBlockId: null,
    underlyingPriceUsd: null,
    underlyingPriceUpdatedAt: null,
    underlyingMarketCapUsd: null,
    verified: true,
    underlyingSymbol: symbol,
    tradingHalted: false,
  };
}
