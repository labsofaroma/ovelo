import type { MarketAsset } from "../../markets";

export type BasketTimeframe = "24h" | "7d" | "30d" | "90d" | "1y" | "ytd";

export interface BasketConstituentPerformance {
  symbol: string;
  mint: string;
  name: string;
  weightBps: number;
  weightPct: number;
  currentPriceUsd: number | null;
  startPriceUsd: number | null;
  changePct: number | null;
  contributionPct: number | null;
  /** Source of the underlying reference price: any source a MarketAsset can carry, or Yahoo history. */
  underlyingPriceSource?:
    | NonNullable<MarketAsset["underlyingPriceSource"]>
    | NonNullable<MarketAsset["priceSource"]>
    | "yahoo-finance"
    | null;
  isRealTimePyth?: boolean;
}

export interface BasketHistoricalPoint {
  date: string;
  value: number; // Normalized NAV index (base = 100)
  changePct: number; // Return from start of period
  volumeUsd?: number | null;
}

export interface BasketPerformance {
  basketId: string;
  timeframe: BasketTimeframe;
  changePct: number | null;
  gainLossUsd: number | null;
  endValueUsd: number | null;
  baseAmountUsd: number;
  asOf: string;
  constituents: BasketConstituentPerformance[];
  topGainer: BasketConstituentPerformance | null;
  topLoser: BasketConstituentPerformance | null;
  history: BasketHistoricalPoint[];
  status: "live" | "partial" | "unavailable";
  sources: string[];
  warnings: string[];
}

export interface PerformanceOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}

export interface BasketMemberInput {
  asset: MarketAsset;
  weightBps: number;
}
