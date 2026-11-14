import "server-only";
import { getMarkets } from "../markets/server";
import type { MarketsView, Pulse } from "../markets/schema";
import type { Loaded } from "../shared/upstream";

export interface LandingSnapshot {
  asOf: string;
  sources: string[];
  pulse: Pick<
    Pulse,
    "pricedAssets" | "totalAssets" | "volume24h" | "volumeCoveredAssets"
  >;
  /** Up to four of the most-traded priced listings, as observed. */
  highlights: MarketsView["rows"];
  basketCount: number;
}

/** Pure, for tests. */
export function toLandingSnapshot(view: MarketsView): LandingSnapshot {
  return {
    asOf: view.asOf,
    sources: view.sources,
    pulse: {
      pricedAssets: view.pulse.pricedAssets,
      totalAssets: view.pulse.totalAssets,
      volume24h: view.pulse.volume24h,
      volumeCoveredAssets: view.pulse.volumeCoveredAssets,
    },
    highlights: view.rows
      .filter((row) => row.price && !row.tradingHalted && row.volume24h)
      .slice(0, 4),
    basketCount: view.baskets.length,
  };
}

/** The landing page's dated market snapshot, from the same cached data as /markets. */
export async function getLandingSnapshot(): Promise<Loaded<LandingSnapshot>> {
  const markets = await getMarkets();
  return markets.state === "ok"
    ? { state: "ok", data: toLandingSnapshot(markets.data) }
    : markets;
}
