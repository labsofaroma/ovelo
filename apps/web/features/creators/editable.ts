import "server-only";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { isDatabaseUnavailable, type CreatorsDb } from "./db";
import { basketIdSchema } from "./schema";
import { getCreatorBasket } from "./server";

/**
 * The builder's `?from=<id>`: a published creator basket, pre-filled to publish its next version.
 * Its content is public anyway; ownership is checked by the server when the new version is
 * signed and published (only the creator wallet can change its basket).
 */
export type Editable =
  | { state: "none" }
  | {
      state: "ok";
      initial: {
        basketId: string;
        name: string;
        ticker: string;
        description: string;
        rows: { mint: string; symbol: string; weightBps: number }[];
        version: number;
      };
    }
  | { state: "unavailable"; reason: string };

export async function loadEditableBasket(
  from: string | null,
  db: () => CreatorsDb = getDb,
): Promise<Editable> {
  if (from === null) return { state: "none" };
  const id = basketIdSchema.safeParse(from);
  if (!id.success)
    return { state: "unavailable", reason: "That basket link is not valid." };
  try {
    const basket = await getCreatorBasket(db(), id.data);
    if (!basket || basket.status !== "published")
      return {
        state: "unavailable",
        reason:
          basket?.status === "archived"
            ? "Archived baskets cannot be published again."
            : "No published creator basket has this id.",
      };
    return {
      state: "ok",
      initial: {
        basketId: basket.id,
        name: basket.name,
        ticker: basket.ticker,
        description: basket.description,
        rows: basket.allocations.map(({ mint, symbol, weightBps }) => ({
          mint,
          symbol,
          weightBps,
        })),
        version: basket.version,
      },
    };
  } catch (error) {
    if (!isDatabaseUnavailable(error))
      logger.error({ err: error }, "editable basket");
    return {
      state: "unavailable",
      reason: "The creator registry is unavailable right now.",
    };
  }
}
