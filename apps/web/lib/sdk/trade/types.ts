import type { MarketAsset } from "../markets";

/** Mainnet swap contracts shared by web and mobile. Amounts are decimal strings. */
export interface TradableAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number | null;
}
export type TradeSide = "buy" | "sell" | "swap";
export interface SwapToken extends TradableAsset {
  verified: boolean;
  source: "issuer" | "jupiter" | "network" | "wallet";
  logoUrl: string | null;
  priceUsd: number | null;
  tradingHalted: boolean;
}
export const MAINNET_SOL_MINT = "So11111111111111111111111111111111111111112";
export const MAINNET_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
/** Protocol identities only. Prices are never seeded; execution rechecks both mint accounts. */

export interface MainnetTradeOrder {
  /** Present on new V1 orders; absent on historical Jupiter orders. */
  transactionVersion?: 0 | 1;
  serializedBytes?: number;
  lastValidBlockHeight?: number;
  requestId: string;
  transaction: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  slippageBps: number;
  feeBps: number;
  feeMint: string;
  router: string;
  priceImpactPct: number | null;
  expiresAt: number;
  authorization: string;
  taker: string;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
  side: TradeSide;
  simulation?: {
    status: "passed";
    simulatedAt: string;
    unitsConsumed: number | null;
  };
}
export const MAX_SWAP_SLIPPAGE_BPS = 300;
export interface MainnetTradeResult {
  status: "Success" | "Failed" | "Unknown";
  signature?: string;
  error?: string;
  totalInputAmount?: string;
  totalOutputAmount?: string;
}
export const UNKNOWN_TRADE_MESSAGE =
  "Confirmation is unknown. This swap may have completed. Check your wallet activity before placing another trade.";

export interface MainnetHolding {
  mint: string;
  symbol: string;
  name: string;
  amount: string;
  displayAmount: string | null;
  priceUsd: number | null;
  valueUsd: number | null;
  valuationUnavailableReason: string | null;
  /** Balance precision comes from mainnet account data, never a token search result. */
  decimals?: number;
  rawAmount?: string;
  spendableAmount?: string;
  frozenAmount?: string;
  logoUrl?: string | null;
  verified?: boolean;
  source?: SwapToken["source"];
  tradingHalted?: boolean;
  native?: boolean;
  tokenProgram?: string;
  marketAsset?: boolean;
}
export interface MainnetPortfolio {
  walletAddress: string;
  network: "mainnet-beta";
  observedAt: string;
  solBalance: string;
  usdcBalance: string;
  holdings: MainnetHolding[];
  pricedHoldingsValueUsd: number;
  hasUnpricedHoldings: boolean;
  warnings?: string[];
}

export interface OnChainTokenBalance {
  mint: string;
  decimals: number;
  rawAmount: string;
  spendableRawAmount: string;
  displayAmount: string | null;
  tokenProgram: string;
}
