import "server-only";
import { unstable_cache } from "next/cache";
import { getStockResearch } from "@/lib/sdk/research/service";
import type { ResearchAsset } from "@/lib/sdk/research/types";
import { getAsset, type AssetLookup } from "../markets/server";
import type { MarketRow } from "../markets/schema";
import {
  load,
  offlineFetch,
  upstreamOutageSimulated,
  type Loaded,
} from "../shared/upstream";
import { toResearchView } from "./normalize";
import {
  researchViewSchema,
  symbolParamSchema,
  type ResearchView,
} from "./schema";

/** Data-cache tags: all research, or one asset's (`v1:research:<mint>`). */
export const RESEARCH_TAG = "v1:research";
export const researchTag = (mint: string) => `${RESEARCH_TAG}:${mint}`;
export const RESEARCH_REVALIDATE_SECONDS = 300;

function researchAsset(row: MarketRow): ResearchAsset {
  return {
    mint: row.mint,
    underlyingSymbol: row.underlyingSymbol,
    name: row.name,
    kind: row.kind,
    issuer: row.issuer,
  };
}

/** Uncached loader (exported for tests): lib/sdk research → zod-validated view. */
export async function fetchResearchView(
  asset: ResearchAsset,
  fetcher?: typeof fetch,
): Promise<ResearchView> {
  const research = await getStockResearch(asset, fetcher ? { fetcher } : {});
  return toResearchView(research);
}

function cachedResearch(asset: ResearchAsset): Promise<ResearchView> {
  return unstable_cache(
    () => fetchResearchView(asset),
    ["v1-research-view", "1", asset.mint, asset.underlyingSymbol],
    {
      tags: [RESEARCH_TAG, researchTag(asset.mint)],
      revalidate: RESEARCH_REVALIDATE_SECONDS,
    },
  )();
}

export async function getResearch(
  row: MarketRow,
): Promise<Loaded<ResearchView>> {
  const asset = researchAsset(row);
  return load(`research:${row.symbol}`, async () =>
    researchViewSchema.parse(
      upstreamOutageSimulated()
        ? await fetchResearchView(asset, offlineFetch)
        : await cachedResearch(asset),
    ),
  );
}

export type StockPage =
  | {
      state: "ok";
      lookup: Extract<AssetLookup, { state: "ok" }>;
      research: Loaded<ResearchView>;
    }
  | { state: "not-found" }
  | Extract<AssetLookup, { state: "unavailable" }>;

/**
 * Everything the stock page needs. An invalid segment is "not-found" (404), not an error.
 * Research failing is NOT a page failure: the token listing still renders with its own sources.
 */
export async function getStockPage(segment: string): Promise<StockPage> {
  const parsed = symbolParamSchema.safeParse(segment);
  if (!parsed.success) return { state: "not-found" };
  const lookup = await getAsset(parsed.data);
  if (lookup.state !== "ok") return lookup;
  return { state: "ok", lookup, research: await getResearch(lookup.row) };
}
