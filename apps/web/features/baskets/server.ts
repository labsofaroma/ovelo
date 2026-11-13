import "server-only";
import { unstable_cache } from "next/cache";
import { fetchBasketHistoricalPerformance } from "@/lib/sdk/baskets/performance";
import { getMarkets } from "../markets/server";
import type { BasketSummary, MarketRow, MarketsView } from "../markets/schema";
import {
  load,
  offlineFetch,
  upstreamOutageSimulated,
  type Loaded,
} from "../shared/upstream";
import { RESEARCH_TAG } from "../stock/server";
import { historyInput, toPerformanceView } from "./normalize";
import {
  basketIdSchema,
  performanceViewSchema,
  type PerformanceRange,
  type PerformanceView,
} from "./schema";

export const PERFORMANCE_REVALIDATE_SECONDS = 3_600;

/** Uncached loader (exported for tests). */
export async function fetchPerformanceView(
  basket: BasketSummary,
  rows: readonly MarketRow[],
  range: PerformanceRange,
  fetcher?: typeof fetch,
): Promise<PerformanceView> {
  const performance = await fetchBasketHistoricalPerformance({
    basket: historyInput(basket, rows),
    timeframe: range,
    options: fetcher ? { fetcher } : {},
  });
  return toPerformanceView(performance, range);
}

export async function getPerformance(
  basket: BasketSummary,
  rows: readonly MarketRow[],
  range: PerformanceRange,
): Promise<Loaded<PerformanceView>> {
  const members = basket.members
    .map((m) => `${m.mint}:${m.weightBps}`)
    .join(",");
  return load(`basket-performance:${basket.id}`, async () =>
    performanceViewSchema.parse(
      upstreamOutageSimulated()
        ? await fetchPerformanceView(basket, rows, range, offlineFetch)
        : await unstable_cache(
            () => fetchPerformanceView(basket, rows, range),
            ["v1-basket-performance", "1", basket.id, range, members],
            {
              // Built from daily share closes, so the research tag refreshes it too.
              tags: [RESEARCH_TAG],
              revalidate: PERFORMANCE_REVALIDATE_SECONDS,
            },
          )(),
    ),
  );
}

export type BasketPage =
  | {
      state: "ok";
      basket: BasketSummary;
      rows: MarketRow[];
      view: MarketsView;
      performance: Loaded<PerformanceView>;
    }
  | { state: "not-found" }
  | Extract<Loaded<MarketsView>, { state: "unavailable" }>;

/** Allocations come from lib/sdk basket definitions via the cached snapshot (PRODUCT.md). */
export async function getBasketPage(
  segment: string,
  range: PerformanceRange,
): Promise<BasketPage> {
  const id = basketIdSchema.safeParse(segment.toLowerCase());
  if (!id.success) return { state: "not-found" };
  const markets = await getMarkets();
  if (markets.state !== "ok") return markets;
  const basket = markets.data.baskets.find((b) => b.id === id.data);
  if (!basket) return { state: "not-found" };
  const byMint = new Map(markets.data.rows.map((row) => [row.mint, row]));
  const rows = basket.members.flatMap((m) => byMint.get(m.mint) ?? []);
  return {
    state: "ok",
    basket,
    rows,
    view: markets.data,
    performance: await getPerformance(basket, markets.data.rows, range),
  };
}
