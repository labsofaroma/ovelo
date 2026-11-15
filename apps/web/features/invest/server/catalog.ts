import "server-only";
import type { Address } from "@solana/kit";
import {
  BASKET_EQUITY_PYTH_FEEDS,
  normalizeSymbol,
  XSTOCKS_PYTH_FEEDS,
} from "@ovelo/guard/pyth";
import type { RegisteredAsset } from "./chain";

/**
 * What can be invested in on this cluster: the v1 asset registry read from chain. An asset's
 * symbol is the equity whose Pyth feed id it was registered with (never typed in by hand), and
 * an asset without a known feed is not offered. A curated or creator basket is offered only when
 * EVERY constituent is a registered, enabled asset here; its weights are the basket's own
 * (lib/sdk for curated baskets, basket_allocations for creator baskets), never re-weighted.
 */

export type CatalogAsset = {
  mint: Address;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: Address;
  enabled: boolean;
  feedId: string;
};

const FEED_TO_EQUITY = new Map<string, { symbol: string; name: string }>();
for (const feed of Object.values(XSTOCKS_PYTH_FEEDS))
  FEED_TO_EQUITY.set(feed.equityReferenceFeedId.toLowerCase(), feed);
for (const feed of Object.values(BASKET_EQUITY_PYTH_FEEDS))
  if (!FEED_TO_EQUITY.has(feed.equityReferenceFeedId.toLowerCase()))
    FEED_TO_EQUITY.set(feed.equityReferenceFeedId.toLowerCase(), feed);

const hex = (bytes: ArrayLike<number>) =>
  "0x" + Buffer.from(Uint8Array.from(bytes)).toString("hex");

export function buildCatalog(
  assets: readonly RegisteredAsset[],
): CatalogAsset[] {
  const out: CatalogAsset[] = [];
  for (const { asset } of assets) {
    const feedId = hex(asset.pythFeedId);
    const equity = FEED_TO_EQUITY.get(feedId);
    if (!equity) continue;
    out.push({
      mint: asset.mint,
      symbol: equity.symbol,
      name: equity.name,
      decimals: asset.decimals,
      tokenProgram: asset.tokenProgram,
      enabled: asset.enabled,
      feedId,
    });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export type BasketSource = {
  id: string;
  name: string;
  kind: "curated" | "creator";
  members: readonly { symbol: string; weightBps: number }[];
};

export type BasketOption = {
  id: string;
  name: string;
  kind: "curated" | "creator";
  available: boolean;
  /** Constituents with no enabled, registered asset on this cluster. */
  missing: string[];
  outputs: { mint: Address; symbol: string; weightBps: number }[];
};

export function basketOptions(
  sources: readonly BasketSource[],
  catalog: readonly CatalogAsset[],
): BasketOption[] {
  const bySymbol = new Map(
    catalog.filter((a) => a.enabled).map((a) => [a.symbol, a]),
  );
  return sources.map((source) => {
    const outputs: BasketOption["outputs"] = [];
    const missing: string[] = [];
    for (const member of source.members) {
      const asset = bySymbol.get(normalizeSymbol(member.symbol));
      if (asset)
        outputs.push({
          mint: asset.mint,
          symbol: asset.symbol,
          weightBps: member.weightBps,
        });
      else missing.push(normalizeSymbol(member.symbol));
    }
    const complete =
      missing.length === 0 &&
      outputs.length === source.members.length &&
      new Set(outputs.map((o) => o.mint)).size === outputs.length &&
      outputs.reduce((sum, o) => sum + o.weightBps, 0) === 10_000;
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      available: complete,
      missing,
      outputs: complete ? outputs : [],
    };
  });
}
