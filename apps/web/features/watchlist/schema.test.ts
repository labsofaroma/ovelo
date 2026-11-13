import { describe, expect, it } from "vitest";
import { mint } from "../test/fixtures";
import {
  cleanMints,
  MAX_WATCHED,
  parseWatchlistParam,
  storedWatchlistSchema,
  watchlistSearch,
} from "./schema";

describe("watchlist schema", () => {
  it("keeps valid unique mints in order and caps the list", () => {
    expect(cleanMints([mint(1), "nope", mint(1), 42, mint(2)])).toEqual([
      mint(1),
      mint(2),
    ]);
    const many = Array.from({ length: MAX_WATCHED + 3 }, (_, i) => mint(i));
    expect(cleanMints(many)).toHaveLength(MAX_WATCHED);
  });
  it("round-trips the ?m= parameter", () => {
    const list = [mint(1), mint(2)];
    expect(parseWatchlistParam(watchlistSearch(list).slice(3))).toEqual(list);
    expect(parseWatchlistParam(undefined)).toEqual([]);
    expect(parseWatchlistParam([`${mint(3)},bad`])).toEqual([mint(3)]);
    expect(parseWatchlistParam("x".repeat(5000))).toEqual([]);
    expect(watchlistSearch([])).toBe("");
  });
  it("rejects malformed stored state", () => {
    expect(storedWatchlistSchema.safeParse({ mints: ["bad"] }).success).toBe(
      false,
    );
    expect(storedWatchlistSchema.safeParse({ mints: [mint(1)] }).success).toBe(
      true,
    );
  });
});
