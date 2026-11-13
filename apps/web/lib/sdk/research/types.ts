import type { MarketAsset } from "../markets";

/** Underlying-company research is separate from the price of its Solana token. */
export interface ResearchBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface ResearchProfile {
  name: string;
  exchange: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  sourceUrl: string;
  observedAt: string;
}

export interface ResearchTechnicals {
  asOf: string;
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  high52w: number | null;
  low52w: number | null;
  averageVolume20: number | null;
  trend: "above-50-day" | "below-50-day" | "at-50-day" | "unavailable";
  basis: "underlying-daily-close";
  sourceUrl: string;
}

export interface ResearchFundamental {
  id: string;
  label: string;
  value: number;
  unit: string;
  periodEnd: string;
  period: "annual" | "quarterly";
  sourceUrl: string;
}

export interface ResearchEvent {
  id: string;
  type: "dividend" | "split" | "filing";
  title: string;
  date: string;
  detail: string;
  sourceUrl: string;
}

export interface ResearchNews {
  title: string;
  publisher: string | null;
  url: string;
  publishedAt: string | null;
}

export interface StockResearch {
  mint: string;
  symbol: string;
  asOf: string;
  status: "available" | "partial" | "unavailable";
  profile: ResearchProfile | null;
  bars: ResearchBar[];
  technicals: ResearchTechnicals | null;
  fundamentals: ResearchFundamental[];
  events: ResearchEvent[];
  news: ResearchNews[];
  sources: Array<{ name: string; url: string }>;
  warnings: string[];
  /** Cached observations are visible while a newer snapshot is being fetched. */
  refreshing?: boolean;
}

export interface ResearchOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  /** Keep a stale-data refresh alive after a serverless response is sent. */
  waitUntil?: (task: Promise<unknown>) => void;
}

export type RequestOptions = ResearchOptions & { signal?: AbortSignal };

export type ResearchAsset = Pick<
  MarketAsset,
  "mint" | "underlyingSymbol" | "name" | "kind" | "issuer"
>;
