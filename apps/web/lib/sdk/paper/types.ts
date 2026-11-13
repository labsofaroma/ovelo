export interface PaperPosition {
  mint: string;
  symbol: string;
  quantity: number;
  costBasisUsd: number;
}
export interface PaperOrder {
  id: string;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  priceUsd: number;
  totalUsd: number;
  createdAt: string;
  swapId?: string;
  realizedPnlUsd?: number;
}
export interface PaperSwapQuote {
  inputMint: string;
  outputMint: string;
  inputQuantity: number;
  outputQuantity: number;
  inputPriceUsd: number;
  outputPriceUsd: number;
  valueUsd: number;
  quotedAt: string;
}
export type PaperFrequency = "daily" | "weekly" | "biweekly" | "monthly";
export interface PaperPlan {
  id: string;
  targetId: string;
  targetType: "asset" | "basket";
  name: string;
  amountUsd: number;
  frequency: PaperFrequency;
  active: boolean;
  nextExecutionAt: string;
  createdAt: string;
  lastError: string | null;
}
export interface PaperAccount {
  version: 1;
  cashUsd: number;
  startingCashUsd: number;
  positions: PaperPosition[];
  orders: PaperOrder[];
  plans: PaperPlan[];
}
export interface PaperValuation {
  cashUsd: number;
  holdingsUsd: number | null;
  totalUsd: number | null;
  equityUsd: number | null;
  profitLossUsd: number | null;
  profitLossPct: number | null;
  unpricedMints: string[];
}
