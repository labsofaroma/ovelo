import type { BasketPerformance } from "./types";

/**
 * Simulates portfolio return and exact profit/loss on an arbitrary invested dollar amount.
 */
export function simulateBasketReturn(
  performance: BasketPerformance,
  investedAmountUsd: number,
): {
  initialUsd: number;
  finalUsd: number;
  gainLossUsd: number;
  gainLossPct: number;
  isProfit: boolean;
} {
  const pct = performance.changePct ?? 0;
  const gainLossUsd = Number(((investedAmountUsd * pct) / 100).toFixed(2));
  const finalUsd = Number((investedAmountUsd + gainLossUsd).toFixed(2));

  return {
    initialUsd: investedAmountUsd,
    finalUsd,
    gainLossUsd,
    gainLossPct: pct,
    isProfit: gainLossUsd >= 0,
  };
}
