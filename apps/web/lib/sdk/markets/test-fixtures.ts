import type { MarketAsset, MarketBasket, MarketSnapshot } from "./types";

/**
 * Typed fixture builders for tests (never imported by product code). Every optional observation
 * defaults to "not observed" (null), so a test states exactly the figures it relies on. Values are
 * arbitrary test numbers, never real quotes.
 */
export function testAsset(overrides: Partial<MarketAsset> = {}): MarketAsset {
  return {
    mint: "test-mint",
    symbol: "TEST",
    name: "Test asset",
    decimals: null,
    issuer: "other",
    kind: "equity",
    logoUrl: null,
    priceUsd: null,
    change24hPct: null,
    volume24hUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    updatedAt: null,
    priceObservedAt: null,
    verified: true,
    sourceUrl: "https://example.test/catalog",
    underlyingSymbol: overrides.symbol ?? "TEST",
    tradingHalted: false,
    ...overrides,
  };
}

export function testBasket(
  overrides: Partial<MarketBasket> = {},
): MarketBasket {
  return {
    id: "test-basket",
    name: "Test basket",
    ticker: "TST",
    description: "Test basket.",
    assets: [],
    available: true,
    missingSymbols: [],
    ...overrides,
  };
}

export function testSnapshot(
  overrides: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  return {
    assets: [],
    baskets: [],
    asOf: "2026-09-12T12:00:00.000Z",
    network: "mainnet-beta",
    sources: [],
    status: "live",
    warnings: [],
    ...overrides,
  };
}
