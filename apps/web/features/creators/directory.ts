import "server-only";
import { getDb } from "@/server/db/client";
import { load, type Loaded } from "../shared/upstream";
import type { CreatorBasketView } from "./schema";
import { listPublishedBaskets, STATS_SOURCE } from "./server";

export type Directory = {
  baskets: CreatorBasketView[];
  asOf: string;
  source: string;
};

/**
 * The public creator directory for `/v1/creators`. Read per request (no cache): publishing must
 * show up at once, and there is no shared cache tag to invalidate yet. A missing or failing
 * database becomes an explicit unavailable state, never an empty list.
 */
export async function getDirectory(
  options: { limit?: number; now?: () => Date } = {},
): Promise<Loaded<Directory>> {
  return load("creator-directory", async () => ({
    baskets: await listPublishedBaskets(getDb(), {
      limit: options.limit ?? 60,
    }),
    asOf: (options.now ?? (() => new Date()))().toISOString(),
    source: STATS_SOURCE,
  }));
}
