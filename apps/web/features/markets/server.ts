import "server-only";
import { unstable_cache } from "next/cache";
import { getMainnetMarkets, type MarketOptions } from "@/lib/sdk/markets";
import { tryGetEnv } from "@/server/env";
import {
  load,
  offlineFetch,
  upstreamOutageSimulated,
  type Loaded,
} from "../shared/upstream";
import { findRow } from "./filter";
import { toMarketsView } from "./normalize";
import { marketsViewSchema, type MarketRow, type MarketsView } from "./schema";

/** Data-cache tag. `revalidateTag(MARKETS_TAG)` (see app/api/v1/revalidate) refreshes every page. */
export const MARKETS_TAG = "v1:markets";
/** Seconds a snapshot is served before a background refresh (stale-while-revalidate). */
export const MARKETS_REVALIDATE_SECONDS = 120;

function marketOptions(): MarketOptions {
  const env = tryGetEnv();
  const server = env.ok ? env.env.server : undefined;
  return {
    jupiterApiKey: server?.JUPITER_API_KEY,
    pythApiKey: server?.PYTH_API_KEY,
    ...(upstreamOutageSimulated() ? { fetcher: offlineFetch } : {}),
  };
}

/** Uncached loader: lib/sdk → zod-validated view. Throws on an unusable snapshot. */
export async function fetchMarketsView(
  options: MarketOptions = marketOptions(),
): Promise<MarketsView> {
  return toMarketsView(await getMainnetMarkets(options));
}

/**
 * One refresh at a time per process. Every page (markets, baskets, stock, builder) reads the same
 * snapshot; when the cache misses or expires, concurrent callers share the in-flight refresh
 * instead of each starting one. Parallel refreshes split the Jupiter quota (5 requests per 10 s
 * on the free tier) and all came back mostly unpriced. Kept on globalThis so separate route
 * bundles in one process share it too.
 */
const INFLIGHT_KEY = "__oveloMarketsRefresh";
function sharedRefresh(): Promise<MarketsView> {
  const slot = globalThis as unknown as Record<
    string,
    Promise<MarketsView> | undefined
  >;
  const running = slot[INFLIGHT_KEY];
  if (running) return running;
  const next = fetchMarketsView().finally(() => {
    slot[INFLIGHT_KEY] = undefined;
  });
  slot[INFLIGHT_KEY] = next;
  return next;
}

/**
 * Next data cache (AUDIT M-9: no disk-cache module). A thrown load is never cached, so an outage
 * keeps serving the last good snapshot with its ORIGINAL `asOf`; the UI then labels it stale.
 */
const cachedMarketsView = unstable_cache(
  () => sharedRefresh(),
  ["v1-markets-view", "1"],
  { tags: [MARKETS_TAG], revalidate: MARKETS_REVALIDATE_SECONDS },
);

export async function getMarkets(): Promise<Loaded<MarketsView>> {
  return load("markets", async () =>
    // Re-parse: the cache is JSON and outlives deploys, so its shape is untrusted too. The
    // outage switch bypasses the cache so the unavailable state is deterministic.
    marketsViewSchema.parse(
      await (upstreamOutageSimulated()
        ? fetchMarketsView()
        : cachedMarketsView()),
    ),
  );
}

export type AssetLookup =
  | { state: "ok"; row: MarketRow; view: MarketsView }
  | { state: "not-found" }
  | Extract<Loaded<MarketsView>, { state: "unavailable" }>;

/** Resolve a /stock/[symbol] segment against the cached catalog. */
export async function getAsset(symbolOrMint: string): Promise<AssetLookup> {
  const markets = await getMarkets();
  if (markets.state !== "ok") return markets;
  const row = findRow(markets.data.rows, symbolOrMint);
  return row
    ? { state: "ok", row, view: markets.data }
    : { state: "not-found" };
}
