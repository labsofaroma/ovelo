import { describe, expect, test } from "vitest";
import {
  BASKET_EQUITY_PYTH_FEEDS,
  getEquityFeedId,
  getStockFeedDefinition,
  listSupportedEquities,
  normalizeSymbol,
  XSTOCKS_PYTH_FEEDS,
} from "./feeds";

const FEED_ID = /^0x[0-9a-f]{64}$/;

describe("Pyth feed registry", () => {
  test("every id is a 32-byte hex feed id and each entry is keyed by its symbol", () => {
    for (const [key, feed] of Object.entries(XSTOCKS_PYTH_FEEDS)) {
      expect(feed.symbol).toBe(key);
      expect(feed.xStockFeedId).toMatch(FEED_ID);
      expect(feed.equityReferenceFeedId).toMatch(FEED_ID);
      expect(feed.xStockFeedId).not.toBe(feed.equityReferenceFeedId);
    }
    for (const [key, feed] of Object.entries(BASKET_EQUITY_PYTH_FEEDS)) {
      expect(feed.symbol).toBe(key);
      expect(feed.equityReferenceFeedId).toMatch(FEED_ID);
    }
    expect(listSupportedEquities()).toHaveLength(
      Object.keys(XSTOCKS_PYTH_FEEDS).length,
    );
  });

  test("normalizes token decorations without stripping real tickers", () => {
    expect(normalizeSymbol(" AAPLx ")).toBe("AAPL");
    expect(normalizeSymbol("xAAPL")).toBe("AAPL");
    expect(normalizeSymbol("XAAPL")).toBe("AAPL");
    expect(normalizeSymbol("preOPENAI")).toBe("OPENAI");
    expect(normalizeSymbol("XOM")).toBe("XOM");
    expect(normalizeSymbol("NFLX")).toBe("NFLX");
  });

  test("resolves feeds from both registries and refuses unknown symbols", () => {
    expect(getStockFeedDefinition("NVDAx")?.symbol).toBe("NVDA");
    expect(getStockFeedDefinition("NOPE")).toBeNull();
    expect(getEquityFeedId("AAPLx")).toBe(
      XSTOCKS_PYTH_FEEDS.AAPL!.equityReferenceFeedId,
    );
    expect(getEquityFeedId("AMD")).toBe(
      BASKET_EQUITY_PYTH_FEEDS.AMD!.equityReferenceFeedId,
    );
    expect(getEquityFeedId("NOPE")).toBeNull();
  });
});
