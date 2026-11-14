import "server-only";
import { getMarkets } from "../markets/server";
import type { MarketRow, MarketsView } from "../markets/schema";
import type { Loaded } from "../shared/upstream";

export interface WatchlistView {
  rows: MarketRow[];
  /** Watched mints the current catalog no longer lists. Shown, never silently dropped. */
  missing: string[];
  asOf: string;
  status: MarketsView["status"];
  warnings: string[];
}

/** Pure part, for tests: keep the user's order, report mints the catalog does not list. */
export function pickWatched(
  view: MarketsView,
  mints: readonly string[],
): WatchlistView {
  const byMint = new Map(view.rows.map((row) => [row.mint, row]));
  const rows: MarketRow[] = [];
  const missing: string[] = [];
  for (const mint of mints) {
    const row = byMint.get(mint);
    if (row) rows.push(row);
    else missing.push(mint);
  }
  return {
    rows,
    missing,
    asOf: view.asOf,
    status: view.status,
    warnings: view.warnings,
  };
}

/** Market data for the watched mints, from the same cached snapshot as /markets. */
export async function getWatchlist(
  mints: readonly string[],
): Promise<Loaded<WatchlistView>> {
  const markets = await getMarkets();
  if (markets.state !== "ok") return markets;
  return { state: "ok", data: pickWatched(markets.data, mints) };
}
