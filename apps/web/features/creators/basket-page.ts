import "server-only";
import type {
  BasketSummary,
  MarketRow,
  MarketsView,
} from "@/features/markets/schema";
import { getMarkets } from "@/features/markets/server";
import type { PublicError } from "@/server/errors";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { type CreatorsDb, isDatabaseUnavailable } from "./db";
import type { CreatorBasketView } from "./schema";
import { getCreatorBasket } from "./server";

/**
 * `/v1/basket/[id]` for a creator basket (UUID ids; curated baskets keep features/baskets). The
 * allocation is what the creator signed (basket_allocations, current version), matched against
 * the cached issuer catalog exactly like a curated basket, so the same AllocationTable,
 * performance view and trade ticket apply.
 */
export type CreatorBasketPage =
  | {
      state: "ok";
      creator: CreatorBasketView;
      basket: BasketSummary;
      rows: MarketRow[];
      view: MarketsView;
    }
  | {
      /** The registry answered but the catalog did not: show the signed weights, no buy. */
      state: "catalog-unavailable";
      creator: CreatorBasketView;
      error: PublicError;
    }
  | { state: "not-found" }
  | { state: "unavailable"; reason: string };

export function toSummary(
  creator: CreatorBasketView,
  view: MarketsView,
): { basket: BasketSummary; rows: MarketRow[] } {
  const byMint = new Map(view.rows.map((row) => [row.mint, row]));
  const listed = creator.allocations.filter((a) => byMint.has(a.mint));
  const rows = listed.map((a) => byMint.get(a.mint)!);
  return {
    basket: {
      id: creator.id,
      name: creator.name,
      ticker: creator.ticker,
      description: creator.description,
      category: "creator",
      // Same meaning as curated baskets (BasketStatusBadge): every constituent listed and priced.
      // Buyability is decided separately (listed, verified, unpaused; no price needed).
      available:
        creator.status === "published" &&
        listed.length === creator.allocations.length &&
        rows.every((row) => row.verified && !row.tradingHalted && row.price),
      missingSymbols: creator.allocations
        .filter((a) => !byMint.has(a.mint))
        .map((a) => a.symbol),
      unpricedSymbols: rows.filter((row) => !row.price).map((r) => r.symbol),
      members: listed.map(({ mint, symbol, weightBps }) => ({
        mint,
        symbol,
        weightBps,
      })),
    },
    rows,
  };
}

/** Published or archived baskets only (drafts are private). */
export async function lookupCreatorBasket(
  id: string,
  db: () => CreatorsDb = getDb,
): Promise<CreatorBasketView | null | "unavailable"> {
  try {
    return await getCreatorBasket(db(), id);
  } catch (error) {
    if (!isDatabaseUnavailable(error))
      logger.error({ err: error }, "creator basket lookup");
    return "unavailable";
  }
}

export async function getCreatorBasketPage(
  id: string,
  db: () => CreatorsDb = getDb,
): Promise<CreatorBasketPage> {
  const creator = await lookupCreatorBasket(id, db);
  if (creator === "unavailable")
    return {
      state: "unavailable",
      reason:
        "The creator registry could not be reached, so this basket cannot be shown right now.",
    };
  if (!creator) return { state: "not-found" };
  const markets = await getMarkets();
  if (markets.state !== "ok")
    return { state: "catalog-unavailable", creator, error: markets.error };
  return {
    state: "ok",
    creator,
    view: markets.data,
    ...toSummary(creator, markets.data),
  };
}
