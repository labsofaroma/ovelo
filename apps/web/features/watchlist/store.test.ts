// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mint } from "../test/fixtures";
import {
  LEGACY_WATCHLIST_KEY,
  safeStorage,
  useWatchlist,
  WATCHLIST_KEY,
} from "./store";

const reset = () => useWatchlist.setState({ mints: [], hydrated: false });

beforeEach(() => {
  // Reset first: a store write persists, so storage is cleared after it.
  reset();
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("watchlist store", () => {
  it("toggles and persists mints only (preferences, never market data)", () => {
    useWatchlist.getState().toggle(mint(1));
    useWatchlist.getState().toggle(mint(2));
    useWatchlist.getState().toggle(mint(1));
    expect(useWatchlist.getState().mints).toEqual([mint(2)]);
    const stored = JSON.parse(window.localStorage.getItem(WATCHLIST_KEY)!);
    expect(stored.state).toEqual({ mints: [mint(2)] });
  });

  it("rehydrates and validates stored data", async () => {
    window.localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify({ state: { mints: [mint(3)] }, version: 1 }),
    );
    await useWatchlist.persist.rehydrate();
    expect(useWatchlist.getState()).toMatchObject({
      mints: [mint(3)],
      hydrated: true,
    });
  });

  it("discards tampered storage instead of trusting it", async () => {
    window.localStorage.setItem(
      WATCHLIST_KEY,
      JSON.stringify({ state: { mints: ["<img onerror=x>"] }, version: 1 }),
    );
    await useWatchlist.persist.rehydrate();
    expect(useWatchlist.getState().mints).toEqual([]);
  });

  it("imports the prototype watchlist once, read-only", async () => {
    window.localStorage.setItem(
      LEGACY_WATCHLIST_KEY,
      JSON.stringify([mint(4), "junk"]),
    );
    await useWatchlist.persist.rehydrate();
    expect(useWatchlist.getState().mints).toEqual([mint(4)]);
    expect(window.localStorage.getItem(LEGACY_WATCHLIST_KEY)).toBe(
      JSON.stringify([mint(4), "junk"]),
    );
  });

  it("survives blocked storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(safeStorage.getItem(WATCHLIST_KEY)).toBeNull();
    expect(() => safeStorage.setItem(WATCHLIST_KEY, "{}")).not.toThrow();
    await useWatchlist.persist.rehydrate();
    useWatchlist.getState().toggle(mint(5));
    expect(useWatchlist.getState()).toMatchObject({
      mints: [mint(5)],
      hydrated: true,
    });
  });
});
