import "server-only";
import { getDb } from "@/server/db/client";
import { purchaseChannels } from "@/server/db/schema";
import { logger } from "@/server/logger";
import type { CreatorsDb } from "./db";

/** Record that a purchase came through the Solana Action (M11; once per signature). */
export async function markActionPurchase(
  signature: string,
  db: CreatorsDb = getDb() as unknown as CreatorsDb,
): Promise<void> {
  try {
    await db
      .insert(purchaseChannels)
      .values({ signature, channel: "action" })
      .onConflictDoNothing({ target: purchaseChannels.signature });
  } catch (err) {
    logger.warn({ err }, "purchase channel not recorded");
  }
}
