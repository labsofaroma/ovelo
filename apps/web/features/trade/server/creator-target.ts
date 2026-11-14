import "server-only";
import { z } from "zod";
import { getCreatorBasket } from "@/features/creators/server";
import type { CreatorsDb } from "@/features/creators/db";

/**
 * Creator baskets as trade targets (M5b B3). Curated baskets are lib/sdk slugs ("sol-core");
 * creator baskets are rows in Postgres keyed by UUID. One id space serves both `/v1/basket/[id]`
 * and `target.basketId`, and the UUID shape decides which source resolves it: a curated slug
 * can never be a UUID (lib/sdk ids are short words joined by hyphens).
 */

const uuid = z.uuid();

/** The id as a creator basket id, or null for a curated slug or a stock. */
export function creatorBasketId(id: string | null | undefined): string | null {
  return id && uuid.safeParse(id).success ? id.toLowerCase() : null;
}

/** What the target resolver needs from a creator basket: status, version and current weights. */
export type CreatorBasketTarget = {
  id: string;
  version: number;
  status: "published" | "archived";
  allocations: readonly { mint: string; symbol: string; weightBps: number }[];
};

/** A published or archived creator basket (drafts are private, so they resolve to null). */
export async function loadCreatorTarget(
  db: CreatorsDb,
  id: string,
): Promise<CreatorBasketTarget | null> {
  const basket = await getCreatorBasket(db, id);
  if (!basket || basket.status === "draft") return null;
  return {
    id: basket.id,
    version: basket.version,
    status: basket.status,
    allocations: basket.allocations,
  };
}
