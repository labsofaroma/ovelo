import { expect, test } from "vitest";
import { assessBasketRoundTrip, BASKET_QUOTE_REVIEW_POLICY } from "./liquidity";
import {
  CANONICAL_BASKET_DEFINITIONS,
  resolveMarketBaskets,
  resolveReviewedMarketBaskets,
} from "../markets";

test("roundtrip review uses exact raw units at the permitted loss boundary", () => {
  expect(BASKET_QUOTE_REVIEW_POLICY.maxRoundTripLossBps).toBe(200);
  expect(assessBasketRoundTrip("1000000", "980000").passes).toBe(true);
  expect(assessBasketRoundTrip("1000000", "979999").passes).toBe(false);
  expect(assessBasketRoundTrip("1000000", "979999").lossBps > 200).toBeTruthy();
  expect(assessBasketRoundTrip("1000000", "1000100").passes).toBe(true);
});

test("missing, malformed, zero and out-of-u64 quote output fail closed", () => {
  for (const output of [null, "", "0", "-1", "1.1", "18446744073709551616"]) {
    expect(assessBasketRoundTrip("1000000", output).passes).toBe(false);
  }
  expect(assessBasketRoundTrip("not-a-number", "1000").passes).toBe(false);
  expect(assessBasketRoundTrip("100", "100", -1).passes).toBe(false);
});

test("published mainnet baskets use reviewed definitions without mutating canonical devnet allocations", () => {
  const symbols = [
    "AAPL",
    "MSFT",
    "NVDA",
    "GOOGL",
    "AMZN",
    "KO",
    "SPY",
    "QQQ",
    "GLD",
  ];
  const assets = symbols.map((underlyingSymbol) => ({
    mint: underlyingSymbol,
    underlyingSymbol,
    issuer: "xstocks",
    priceUsd: 10,
    tradingHalted: false,
    verified: true,
  }));
  const reviewed = resolveReviewedMarketBaskets(assets);
  expect(reviewed.map((b) => b.id)).toEqual([
    "sol-digital-leaders",
    "sol-ai-focused",
    "sol-everyday-focused",
    "sol-core",
  ]);
  const canonical = resolveMarketBaskets([]);
  expect(
    canonical.some((b) => b.id === "sol-mag7"),
    "canonical thematic baskets remain discoverable independently of the focused reviewed subset",
  ).toBe(true);
  for (const basket of reviewed) {
    expect(basket.assets.length).toBe(3);
    expect(basket.assets.reduce((sum, leg) => sum + leg.weight, 0)).toBe(10000);
    expect(basket.available).toBe(true);
  }
  expect(canonical.map((basket) => basket.id)).toEqual(
    CANONICAL_BASKET_DEFINITIONS.map((definition) => definition.id),
  );
  expect(canonical.find((b) => b.id === "sol-ai-infra").missingSymbols).toEqual(
    ["NVDA", "MSFT", "GOOGL", "AMZN", "ORCL"],
  );
  assets[0].issuer = "backpack";
  const missing = resolveReviewedMarketBaskets(assets)[0];
  expect(missing.available).toBe(false);
  expect(missing.missingSymbols).toEqual(["AAPL"]);
  expect(
    missing.assets.reduce((sum, leg) => sum + leg.weight, 0) < 10000,
  ).toBeTruthy();
});
