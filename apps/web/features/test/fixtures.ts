import type { MarketAsset, MarketSnapshot } from "@/lib/sdk/markets";
import type { StockResearch } from "@/lib/sdk/research/types";

/** Test-only fixtures. Values are arbitrary test numbers, never shown in the UI. */
export const mint = (n: number): string => `Mint${n}`.padEnd(44, "1");

export const NOW = Date.parse("2026-11-13T12:00:00.000Z");
export const iso = (offsetMs = 0): string =>
  new Date(NOW + offsetMs).toISOString();

export function asset(overrides: Partial<MarketAsset> = {}): MarketAsset {
  return {
    mint: mint(1),
    symbol: "TESTx",
    name: "Test Corp",
    decimals: 8,
    issuer: "xstocks",
    kind: "equity",
    logoUrl: null,
    priceUsd: 101.25,
    change24hPct: 1.5,
    volume24hUsd: 250_000,
    liquidityUsd: 90_000,
    marketCapUsd: 1_000_000,
    updatedAt: iso(),
    priceObservedAt: iso(),
    priceSource: "jupiter-tokens-v2",
    verified: true,
    sourceUrl: "https://example.test/catalog",
    underlyingSymbol: "TEST",
    tradingHalted: false,
    ...overrides,
  };
}

export function snapshot(
  overrides: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  const assets = overrides.assets ?? [
    asset(),
    asset({
      mint: mint(2),
      symbol: "DOWNx",
      name: "Down Inc",
      underlyingSymbol: "DOWN",
      priceUsd: 20,
      change24hPct: -3.25,
      volume24hUsd: 50_000,
    }),
    asset({
      mint: mint(3),
      symbol: "NOPx",
      name: "No Price Ltd",
      underlyingSymbol: "NOP",
      priceUsd: null,
      priceObservedAt: null,
      priceSource: null,
      change24hPct: null,
      volume24hUsd: null,
      underlyingPriceUsd: 42,
      underlyingPriceSource: "pyth",
      underlyingPriceUpdatedAt: iso(-60_000),
    }),
  ];
  return {
    assets,
    baskets: [
      {
        id: "test-basket",
        name: "Test basket",
        ticker: "TST",
        description: "Two test assets.",
        category: "technology",
        assets: [
          { asset: assets[0]!, weight: 5_000 },
          { asset: assets[1]!, weight: 5_000 },
        ],
        available: true,
        missingSymbols: [],
        unpricedSymbols: [],
      },
    ],
    asOf: iso(),
    network: "mainnet-beta",
    sources: ["xStocks issuer catalog", "Jupiter Tokens V2"],
    status: "live",
    warnings: [],
    ...overrides,
  };
}

export function research(
  overrides: Partial<StockResearch> = {},
): StockResearch {
  return {
    mint: mint(1),
    symbol: "TEST",
    asOf: iso(),
    status: "available",
    profile: {
      name: "Test Corp",
      exchange: "NMS",
      currency: "USD",
      sector: "Technology",
      industry: "Software",
      description: "Makes test software.",
      website: "https://example.test",
      sourceUrl: "https://example.test/profile",
      observedAt: iso(),
    },
    bars: [
      { date: "2026-11-10", open: 1, high: 2, low: 1, close: 100, volume: 10 },
      {
        date: "2026-11-11",
        open: 1,
        high: 2,
        low: 1,
        close: 102.5,
        volume: 10,
      },
      {
        date: "2026-11-12",
        open: 1,
        high: 2,
        low: 1,
        close: 99.75,
        volume: null,
      },
    ],
    technicals: {
      asOf: "2026-11-12",
      close: 99.75,
      sma20: 100,
      sma50: 98,
      sma200: null,
      rsi14: 55.5,
      high52w: 120,
      low52w: 80,
      averageVolume20: null,
      trend: "above-50-day",
      basis: "underlying-daily-close",
      sourceUrl: "https://example.test/chart",
    },
    fundamentals: [
      {
        id: "rev",
        label: "Revenue",
        value: 1_234_567_890,
        unit: "USD",
        periodEnd: "2025-12-31",
        period: "annual",
        sourceUrl: "https://example.test/fundamentals",
      },
    ],
    events: [],
    news: [
      {
        title: "Test Corp ships",
        publisher: "Example News",
        url: "https://example.test/news/1",
        publishedAt: iso(-3_600_000),
      },
      {
        title: "Bad link",
        publisher: null,
        url: "javascript:alert(1)",
        publishedAt: null,
      },
    ],
    sources: [{ name: "Yahoo Finance", url: "https://example.test/yahoo" }],
    warnings: [],
    ...overrides,
  };
}
