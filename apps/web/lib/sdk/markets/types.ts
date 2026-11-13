import type { BasketLiquidityAudit } from "../basket/liquidity-audit";
import type { BackpackSecurity } from "../backpack";

/** Mainnet issuer catalogs and observed onchain market prices. Unknown values stay null. */
export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Persisted issuer data must come from the loader that verifies every page. */
export const ISSUER_CATALOG_VERSION = 1;

export interface MarketAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number | null;
  issuer: "xstocks" | "prestocks" | "backpack" | "other";
  kind: "equity" | "etf" | "pre-ipo" | "unknown";
  logoUrl: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  updatedAt: string | null;
  priceObservedAt: string | null;
  /** Source of the tradable token price; underlying share quotes are kept separate. */
  priceSource?:
    "jupiter-tokens-v2" | "jupiter-price-v3" | "prestocks-issuer" | null;
  priceBlockId?: number | null;
  underlyingPriceUsd?: number | null;
  underlyingPriceUpdatedAt?: string | null;
  underlyingMarketCapUsd?: number | null;
  underlyingPriceSource?: "pyth" | "jupiter-stock-data" | null;
  underlyingConfidenceUsd?: number | null;
  isRealTimePyth?: boolean;
  verified: boolean;
  sourceUrl: string;
  underlyingSymbol: string;
  tradingHalted: boolean;
  tradingNotice?: string;
}

export interface MarketBasket {
  id: string;
  name: string;
  ticker: string;
  description: string;
  category?:
    | "technology"
    | "consumer"
    | "healthcare"
    | "finance"
    | "industrials"
    | "energy"
    | "diversified"
    | "private"
    | "custom";
  assets: Array<{ asset: MarketAsset; weight: number }>;
  available: boolean;
  missingSymbols: string[];
  unpricedSymbols?: string[];
  liquidityAudit?: BasketLiquidityAudit;
  isCustom?: boolean;
  creatorName?: string;
  creatorSocial?: string;
}

export interface MarketSnapshot {
  assets: MarketAsset[];
  /** Exchange discovery is separate from the executable Solana token catalog. */
  backpackSecurities?: BackpackSecurity[];
  backpackObservedAt?: string;
  baskets: MarketBasket[];
  asOf: string;
  network: "mainnet-beta";
  sources: string[];
  status: "live" | "partial" | "unavailable";
  warnings: string[];
  /** More observed data is being fetched; existing timestamps are unchanged. */
  refreshing?: boolean;
  issuerCatalogVersion?: number;
}

export interface MarketOptions {
  jupiterApiKey?: string;
  jupiterBaseUrl?: string;
  pythApiKey?: string;
  pythBaseUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  /** Reuse a separately verified issuer catalog without waiting for all prices. */
  catalog?: MarketSnapshot;
  /** Reference quotes refresh less frequently than token-market observations. */
  includePriceReferences?: boolean;
  /** Previously observed V3-priced tokens still need fresh token quotes. */
  priceFallbackMints?: readonly string[];
  /** Publishes token-market observations before optional reference enrichment. */
  onUpdate?: (snapshot: MarketSnapshot) => void;
}

export interface BasketConstituentDefinition {
  id: string;
  name: string;
  ticker: string;
  category: MarketBasket["category"];
  description: string;
  symbols: string[];
  issuer: MarketAsset["issuer"];
}
