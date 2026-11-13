/** Pyth oracle errors and data shapes. */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PythOracleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PythOracleError";
    Object.setPrototypeOf(this, PythOracleError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PythPriceData {
  /** The 0x-prefixed Pyth feed ID */
  feedId: string;
  /** Human-readable USD price computed as rawPrice × 10^expo */
  price: number;
  /** Confidence interval in USD */
  confidence: number;
  /** Price exponent (e.g. -8) */
  expo: number;
  /** Raw integer price from oracle */
  rawPrice: string;
  /** Raw confidence integer */
  rawConfidence: string;
  /** Unix timestamp of publication */
  publishTime: number;
  /** Feed status */
  status: "trading" | "halted" | "unknown";
}

export interface PythFeedInfo {
  id: string;
  market_hours?: {
    is_open: boolean;
    next_open?: number | null;
    next_close?: number | null;
  };
  attributes: Record<string, string>;
}

export interface XStocksOracleInfo {
  symbol: string;
  name?: string;
  mint?: string;
  oracleAddress?: string;
  oracleType?: "pyth" | "switchboard";
  feedId?: string;
  price?: number;
  lastUpdated?: number;
  maxStalenessSeconds?: number;
  confidenceThresholdPct?: number;
}
