import type { BasketPerformance } from "@/lib/sdk/baskets/performance";
import type { BasketSummary, MarketRow } from "../markets/schema";
import { fixedFromNumber } from "../shared/fixed";
import {
  performanceViewSchema,
  type PerformanceRange,
  type PerformanceView,
} from "./schema";

/**
 * The basket handed to lib/sdk for history: identity and weights. The sdk builds the series from
 * observed share closes only and never substitutes a token price (M3-SDK-REQUESTS #2, resolved).
 */
export function historyInput(
  basket: BasketSummary,
  rows: readonly MarketRow[],
): {
  id: string;
  assets: { asset: Record<string, unknown>; weight: number }[];
} {
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  return {
    id: basket.id,
    assets: basket.members.flatMap((member) => {
      const row = byMint.get(member.mint);
      return row
        ? [
            {
              asset: {
                mint: row.mint,
                symbol: row.symbol,
                underlyingSymbol: row.underlyingSymbol,
                name: row.name,
              },
              weight: member.weightBps,
            },
          ]
        : [];
    }),
  };
}

const pct = (value: number | null) => fixedFromNumber(value, 4);

/** lib/sdk BasketPerformance → view. Throws when nothing could be computed (never cached). */
export function toPerformanceView(
  performance: BasketPerformance,
  range: PerformanceRange,
): PerformanceView {
  if (performance.status === "unavailable" || performance.history.length < 2)
    throw new Error("basket performance unavailable");
  return performanceViewSchema.parse({
    basketId: performance.basketId,
    range,
    asOf: performance.asOf,
    status: performance.status,
    change: pct(performance.changePct),
    startDate: performance.history[0]?.date ?? null,
    endDate: performance.history.at(-1)?.date ?? null,
    series: performance.history.flatMap((point) => {
      const close = fixedFromNumber(point.value, 2);
      return close ? [{ date: point.date, close }] : [];
    }),
    constituents: performance.constituents.map((item) => ({
      mint: item.mint,
      symbol: item.symbol,
      weightBps: item.weightBps,
      change: pct(item.changePct),
      contribution: pct(item.contributionPct),
    })),
    // lib/sdk names only the providers whose observations fed the result (M3-SDK-REQUESTS #3).
    sources: performance.sources,
    warnings: performance.warnings,
  });
}
