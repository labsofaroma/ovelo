import { expect, test } from "vitest";
import {
  calculateBasket24hGrowth,
  fetchBasketHistoricalPerformance,
  simulateBasketReturn,
  extractBasketMembers,
} from "./index";
import type { MarketAsset } from "../../markets";
import { testAsset } from "../../markets/test-fixtures";

const makeAsset = (
  symbol: string,
  change24hPct: number | null,
  priceUsd: number | null = 100,
  extra: Partial<MarketAsset> = {},
): MarketAsset =>
  testAsset({
    mint: `${symbol}_MINT_111111111111111111111111111111`,
    symbol,
    underlyingSymbol: symbol,
    name: `${symbol} Inc.`,
    priceUsd,
    change24hPct,
    tradingHalted: false,
    ...extra,
  });

test("calculateBasket24hGrowth calculates exact weighted return and attribution for a balanced basket", () => {
  const basket = {
    id: "test-basket-ai",
    name: "AI Test Basket",
    assets: [
      { asset: makeAsset("NVDA", 5.0, 120), weight: 5000 },
      { asset: makeAsset("MSFT", -1.0, 400), weight: 5000 },
    ],
  };

  const perf = calculateBasket24hGrowth(basket, 1000);
  expect(perf.basketId).toBe("test-basket-ai");
  expect(perf.timeframe).toBe("24h");
  expect(perf.status).toBe("live");
  // (5000/10000)*5.0 + (5000/10000)*(-1.0) = 2.5 - 0.5 = 2.0%
  expect(perf.changePct).toBe(2.0);
  expect(perf.gainLossUsd).toBe(20.0);
  expect(perf.endValueUsd).toBe(1020.0);
  expect(perf.constituents.length).toBe(2);

  // Attribution
  expect(perf.constituents[0].symbol).toBe("NVDA");
  expect(perf.constituents[0].contributionPct).toBe(2.5);
  expect(perf.constituents[1].symbol).toBe("MSFT");
  expect(perf.constituents[1].contributionPct).toBe(-0.5);

  expect(perf.topGainer?.symbol).toBe("NVDA");
  expect(perf.topLoser?.symbol).toBe("MSFT");
});

test("calculateBasket24hGrowth handles partial pricing without fabricating data", () => {
  const basket = {
    id: "test-partial",
    name: "Partial Basket",
    assets: [
      { asset: makeAsset("AAPL", 4.0, 200), weight: 5000 },
      { asset: makeAsset("UNPRICED", null, null), weight: 5000 },
    ],
  };

  const perf = calculateBasket24hGrowth(basket, 1000);
  expect(perf.status).toBe("partial");
  expect(perf.warnings.length > 0).toBeTruthy();
  // Renormalized against priced asset: 4.0%
  expect(perf.changePct).toBe(4.0);
  expect(perf.constituents[1].changePct).toBe(null);
  expect(perf.constituents[1].contributionPct).toBe(null);
});

test("calculateBasket24hGrowth returns unavailable when all assets are unpriced or empty", () => {
  const emptyPerf = calculateBasket24hGrowth({ id: "empty", assets: [] });
  expect(emptyPerf.status).toBe("unavailable");
  expect(emptyPerf.changePct).toBe(null);

  const unpricedPerf = calculateBasket24hGrowth({
    id: "all-unpriced",
    assets: [
      { asset: makeAsset("A", null, null) },
      { asset: makeAsset("B", null, null) },
    ],
  });
  expect(unpricedPerf.status).toBe("unavailable");
  expect(unpricedPerf.changePct).toBe(null);
});

test("simulateBasketReturn calculates exact profit and loss on custom amounts", () => {
  const perf = { changePct: 15.5 };
  const sim = simulateBasketReturn(perf, 5000);
  expect(sim.initialUsd).toBe(5000);
  expect(sim.gainLossUsd).toBe(775.0);
  expect(sim.finalUsd).toBe(5775.0);
  expect(sim.gainLossPct).toBe(15.5);
  expect(sim.isProfit).toBe(true);

  const lossPerf = { changePct: -8.2 };
  const lossSim = simulateBasketReturn(lossPerf, 1000);
  expect(lossSim.gainLossUsd).toBe(-82.0);
  expect(lossSim.finalUsd).toBe(918.0);
  expect(lossSim.isProfit).toBe(false);
});

test("extractBasketMembers normalizes both raw asset arrays and MarketBasket schemas", () => {
  // Case 1: MarketBasket format with source
  const displayBasket = {
    source: {
      assets: [
        { asset: makeAsset("A", 1), weight: 6000 },
        { asset: makeAsset("B", 2), weight: 4000 },
      ],
    },
  };
  const members1 = extractBasketMembers(displayBasket);
  expect(members1.length).toBe(2);
  expect(members1[0].weightBps).toBe(6000);
  expect(members1[1].weightBps).toBe(4000);

  // Case 2: Direct assets array without explicit weights (equal weights via Hare-Niemeyer)
  const plainBasket = {
    assets: [makeAsset("A", 1), makeAsset("B", 2), makeAsset("C", 3)],
  };
  const members2 = extractBasketMembers(plainBasket);
  expect(members2.length).toBe(3);
  // 10000 / 3 = 3333 with 1 remainder -> 3334, 3333, 3333
  expect(members2[0].weightBps).toBe(3334);
  expect(members2[1].weightBps).toBe(3333);
  expect(members2[2].weightBps).toBe(3333);
  expect(
    members2[0].weightBps + members2[1].weightBps + members2[2].weightBps,
  ).toBe(10000);
});

test("fetchBasketHistoricalPerformance computes normalized NAV series and attribution using mock fetcher", async () => {
  const mockBars: Record<string, { date: string; close: number }[]> = {
    AAPL: [
      { date: "2026-09-17", close: 100 },
      { date: "2026-09-18", close: 105 },
      { date: "2026-09-19", close: 110 },
    ],
    MSFT: [
      { date: "2026-09-17", close: 200 },
      { date: "2026-09-18", close: 190 },
      { date: "2026-09-19", close: 210 },
    ],
  };

  const mockFetcher = async (input: RequestInfo | URL) => {
    const symMatch = String(input).match(/\/chart\/([A-Za-z]+)\?/);
    const sym = symMatch?.[1] ?? "";
    const bars = mockBars[sym] || [];
    return Response.json({
      chart: {
        result: [
          {
            timestamp: bars.map((b) =>
              Math.floor(new Date(`${b.date}T00:00:00Z`).getTime() / 1000),
            ),
            indicators: {
              quote: [{ close: bars.map((b) => b.close) }],
            },
          },
        ],
      },
    });
  };

  const basket = {
    id: "test-tech",
    name: "Tech Basket",
    assets: [
      { asset: makeAsset("AAPL", 0), weight: 5000 },
      { asset: makeAsset("MSFT", 0), weight: 5000 },
    ],
  };

  const perf = await fetchBasketHistoricalPerformance({
    basket,
    timeframe: "7d",
    baseAmountUsd: 1000,
    options: {
      fetcher: mockFetcher,
      now: () => new Date("2026-09-20T00:00:00Z").getTime(),
    },
  });

  expect(perf.status).toBe("live");
  expect(perf.timeframe).toBe("7d");
  expect(perf.history.length).toBe(3);
  // Start: NAV = 100
  expect(perf.history[0].value).toBe(100);
  expect(perf.history[0].changePct).toBe(0);

  // Day 3:
  // AAPL: 100 -> 110 (+10%), MSFT: 200 -> 210 (+5%)
  // Basket NAV: 0.5 * 110 + 0.5 * 105 = 55 + 52.5 = 107.5
  expect(perf.history[2].value).toBe(107.5);
  expect(perf.changePct).toBe(7.5);
  expect(perf.gainLossUsd).toBe(75.0);
  expect(perf.endValueUsd).toBe(1075.0);

  // Constituents attribution:
  expect(perf.constituents[0].symbol).toBe("AAPL");
  expect(perf.constituents[0].changePct).toBe(10.0);
  expect(perf.constituents[0].contributionPct).toBe(5.0);

  expect(perf.constituents[1].symbol).toBe("MSFT");
  expect(perf.constituents[1].changePct).toBe(5.0);
  expect(perf.constituents[1].contributionPct).toBe(2.5);
});

test("calculateBasket24hGrowth names a provider only when its observation contributed", () => {
  const perf = calculateBasket24hGrowth(
    {
      id: "sources",
      assets: [
        // NVDA has a Pyth feed and a Jupiter token price but no observed 24h change.
        {
          asset: makeAsset("NVDA", null, 120, {
            priceSource: "jupiter-price-v3",
          }),
          weight: 5000,
        },
        { asset: makeAsset("MSFT", 1.0, 400), weight: 5000 },
      ],
    },
    1000,
  );
  expect(perf.sources).not.toContain("Pyth Network Reference Feeds");
  expect(perf.sources).not.toContain("Jupiter Token Observations");

  const contributed = calculateBasket24hGrowth(
    {
      id: "sources-2",
      assets: [
        {
          asset: makeAsset("NVDA", 2.0, 120, {
            priceSource: "jupiter-price-v3",
            isRealTimePyth: true,
          }),
          weight: 10_000,
        },
      ],
    },
    1000,
  );
  expect(contributed.sources).toEqual([
    "Jupiter Token Observations",
    "Pyth Network Oracles",
  ]);
});
