import { expect, test } from "vitest";
import type { MarketAsset } from "../markets";
import { getMarketPulse } from "./pulse";

const asset = (
  symbol: string,
  change24hPct: number | null,
  volume24hUsd: number | null,
  extra: Partial<MarketAsset> = {},
) =>
  ({
    mint: symbol,
    symbol,
    priceUsd: 10,
    tradingHalted: false,
    change24hPct,
    volume24hUsd,
    ...extra,
  }) as MarketAsset;

test("market pulse computes covered breadth and volume without treating missing quotes as zero", () => {
  const assets = [
    asset("A", 5, 100),
    asset("B", -3, 200),
    asset("C", 0, 0),
    asset("D", null, null),
    asset("E", 20, 1000, { priceUsd: null, underlyingPriceUsd: 40 }),
    asset("F", 50, 2000, { tradingHalted: true }),
  ];
  const before = JSON.stringify(assets);
  const pulse = getMarketPulse(assets);
  expect(pulse.totalAssets).toBe(6);
  expect(pulse.tradableAssets).toBe(5);
  expect(pulse.pricedAssets).toBe(4);
  expect({ ...pulse.breadth, advancingPct: null }).toEqual({
    advancing: 1,
    declining: 1,
    unchanged: 1,
    coveredAssets: 3,
    advancingPct: null,
  });
  expect(Math.abs(pulse.breadth.advancingPct - 100 / 3) < 1e-10).toBeTruthy();
  expect(pulse.volume24hUsd).toBe(300);
  expect(pulse.volumeCoveredAssets).toBe(3);
  expect(pulse.topVolume.map((a) => a.symbol)).toEqual(["B", "A", "C"]);
  expect(pulse.gainers.map((a) => a.symbol)).toEqual(["A"]);
  expect(pulse.losers.map((a) => a.symbol)).toEqual(["B"]);
  expect(JSON.stringify(assets)).toBe(before);
});

test("market pulse handles empty coverage, duplicate mints and invalid numeric values", () => {
  expect(getMarketPulse([]).volume24hUsd).toBe(null);
  expect(getMarketPulse([]).breadth.advancingPct).toBe(null);
  const pulse = getMarketPulse(
    [
      asset("A", 5, 10),
      asset("A", 2, 3),
      asset("B", NaN, -10),
      asset("C", 1, 10, { priceUsd: Infinity }),
    ],
    1,
  );
  expect(pulse.totalAssets).toBe(3);
  expect(pulse.breadth.coveredAssets).toBe(1);
  expect(pulse.volume24hUsd).toBe(3);
  expect(pulse.topVolume.length).toBe(1);
});

test("market pulse safeguards exclude illiquid (<$1000) and depegged (>15%) assets from movers", () => {
  const assets = [
    asset("LEGIT_GAINER", 12, 500, {
      liquidityUsd: 5000,
      priceUsd: 100,
      underlyingPriceUsd: 100,
    }),
    asset("ILLIQUID_GAINER", 39, 292, {
      liquidityUsd: 79.9,
      priceUsd: 278.8,
      underlyingPriceUsd: 70.66,
    }),
    asset("DEPEGGED_GAINER", 25, 1000, {
      liquidityUsd: 50000,
      priceUsd: 150,
      underlyingPriceUsd: 100,
    }),
    asset("LEGIT_LOSER", -8, 400, {
      liquidityUsd: 8000,
      priceUsd: 50,
      underlyingPriceUsd: 50,
    }),
    asset("ILLIQUID_LOSER", -40, 100, { liquidityUsd: 120 }),
    asset("UNTRACKED_LIQ", 6, 200), // undefined liquidity should not be filtered out
  ];
  const pulse = getMarketPulse(assets, 10);
  // Breadth still includes all 6 changing assets (objective market breadth)
  expect(pulse.breadth.coveredAssets).toBe(6);
  expect(pulse.breadth.advancing).toBe(4);
  expect(pulse.breadth.declining).toBe(2);

  // Gainers: ILLIQUID_GAINER (liq $79.9 < $1000) and DEPEGGED_GAINER (50% divergence > 15%) are excluded!
  expect(pulse.gainers.map((a) => a.symbol)).toEqual([
    "LEGIT_GAINER",
    "UNTRACKED_LIQ",
  ]);

  // Losers: ILLIQUID_LOSER (liq $120 < $1000) is excluded!
  expect(pulse.losers.map((a) => a.symbol)).toEqual(["LEGIT_LOSER"]);

  // Top Volume: ILLIQUID_GAINER and ILLIQUID_LOSER excluded from top movers
  expect(pulse.topVolume.map((a) => a.symbol)).toEqual([
    "LEGIT_GAINER",
    "LEGIT_LOSER",
    "UNTRACKED_LIQ",
  ]);

  // Safeguards can be disabled with options: { minLiquidityUsd: 0, maxDivergencePct: 0 }
  const unfiltered = getMarketPulse(assets, 10, {
    minLiquidityUsd: 0,
    maxDivergencePct: 0,
  });
  expect(unfiltered.gainers.length).toBe(4);
  expect(unfiltered.losers.length).toBe(2);
});
