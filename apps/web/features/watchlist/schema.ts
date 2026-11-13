import { z } from "zod";

/** Watchlist entries are mints: symbols can repeat across issuers, mints cannot. */
export const mintSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const MAX_WATCHED = 50;

/** What is persisted in localStorage. Anything else found there is discarded, never trusted. */
export const storedWatchlistSchema = z.object({
  mints: z.array(mintSchema).max(MAX_WATCHED),
});
export type StoredWatchlist = z.infer<typeof storedWatchlistSchema>;

/** Keeps valid, unique mints in order, capped. Used for storage, legacy import and URLs. */
export function cleanMints(values: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (out.length >= MAX_WATCHED) break;
    if (mintSchema.safeParse(value).success && !out.includes(value as string))
      out.push(value as string);
  }
  return out;
}

/** `?m=mintA,mintB`: the watchlist page renders on the server from this URL parameter. */
export function parseWatchlistParam(value: unknown): string[] {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string" || text.length > 50 * 45) return [];
  return cleanMints(text.split(","));
}

export function watchlistSearch(mints: readonly string[]): string {
  return mints.length ? `?m=${mints.join(",")}` : "";
}
