import { expect, test } from "vitest";
import { basketSymbols, DEVNET_ASSETS, selectAssets } from "./lib/assets";
import { XSTOCKS_PYTH_FEEDS } from "@aroma/guard/pyth";

test("every devnet asset is a canonical basket constituent with its real Pyth equity feed", () => {
  const baskets = basketSymbols();
  for (const a of DEVNET_ASSETS) {
    expect(baskets.has(a.underlying), a.underlying).toBe(true);
    expect(`0x${a.feedId}`).toBe(
      XSTOCKS_PYTH_FEEDS[a.underlying]!.equityReferenceFeedId,
    );
    expect(a.feedId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.multiplier).toBeGreaterThanOrEqual(1);
  }
});

test("symbol selection normalizes, de-duplicates and refuses unknown symbols", () => {
  expect(selectAssets("aapl, MSFT,aapl").map((a) => a.underlying)).toEqual([
    "AAPL",
    "MSFT",
  ]);
  expect(selectAssets(undefined)).toHaveLength(DEVNET_ASSETS.length);
  expect(() => selectAssets("AAPL,KUSD")).toThrow(/Not devnet assets: KUSD/);
});
