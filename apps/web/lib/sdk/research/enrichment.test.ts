import { expect, test } from "vitest";
import { getStockResearch as loadResearch } from "./index";

/** Fixtures pass partial assets and fake fetchers; the cast keeps tests focused on behaviour. */
const getStockResearch = (asset: unknown, options?: unknown) =>
  loadResearch(asset as never, options as never);

// Provider fixtures exist only in tests. Production research never seeds missing facts.
const now = Date.parse("2026-09-12T12:00:00Z");
const asset = {
  mint: "11111111111111111111111111111111",
  underlyingSymbol: "NVDA",
  name: "NVIDIA",
  issuer: "xstocks",
  kind: "equity",
};
const json = (value: unknown) => new Response(JSON.stringify(value));
const fact = (
  value: number,
  asOfDate: string,
  currencyCode = "USD", periodType = "12M") => ({
  asOfDate,
  periodType,
  currencyCode,
  reportedValue: { raw: value },
});
const series = (type: string, values: unknown[], symbol = "NVDA") => ({
  meta: { type: [type], symbol: [symbol] },
  [type]: values,
});
const chart = (symbol = "NVDA") => ({
  chart: {
    result: [
      {
        meta: {
          symbol,
          longName: "NVIDIA Corporation",
          fullExchangeName: "NasdaqGS",
          currency: "USD",
          instrumentType: "EQUITY",
        },
        timestamp: [1788958800, 1789045200, 1789131600, 1789218000],
        indicators: {
          quote: [
            {
              open: [10, 11, null, 14],
              high: [12, 13, 14, 12],
              low: [9, 10, 11, 11],
              close: [11, 12, 13, 13],
              volume: [100, 200, 300, 400],
            },
          ],
        },
        events: {
          dividends: { one: { date: 1789045200, amount: 0.25 } },
          splits: { two: { date: 1788958800, numerator: 10, denominator: 1 } },
        },
      },
    ],
  },
});

test("provider outages never populate synthetic values, bars, news or fundamentals", async () => {
  const result = await getStockResearch(asset, {
    now: () => now,
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  expect(result.status).toBe("unavailable");
  expect(result.profile).toBe(null);
  expect(result.technicals).toBe(null);
  for (const field of ["bars", "fundamentals", "events", "news", "sources"] as const)
    expect(result[field]).toEqual([]);
  await await expect(
    getStockResearch({ ...asset, underlyingSymbol: "https://example.com" }),
  ).rejects.toThrow(/Unsupported research symbol/);
});

test("an unrelated encyclopedia result is not used as the company overview", async () => {
  const urls: string[] = [];
  const result = await getStockResearch(asset, {
    now: () => now,
    fetcher: async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/chart/")) return json(chart());
      if (url.includes("generator=search"))
        return json({
          query: {
            pages: {
              123: {
                pageid: 123,
                title: "Different company",
                extract: "Facts about an unrelated business.",
              },
            },
          },
        });
      return json({});
    },
  });
  expect(result.profile!.name).toBe("NVIDIA Corporation");
  expect(result.profile!.description).toBe(null);
  expect(urls.filter((url) => url.includes("wikipedia")).length).toBe(1);
});

test("company enrichment starts before slow financials finish and shares one request deadline", async () => {
  const urls: string[] = [];
  const signals: unknown[] = [];
  let finishFinancials;
  const financials = new Promise((resolve) => {
    finishFinancials = resolve;
  });
  const operation = getStockResearch(asset, {
    now: () => now,
    fetcher: async (input: unknown, init: RequestInit) => {
      const url = String(input);
      urls.push(url);
      signals.push(init.signal);
      if (url.includes("/chart/")) return json(chart());
      if (url.includes("/timeseries/")) return financials;
      if (url.includes("wikipedia"))
        return json({
          query: {
            pages: {
              12: {
                pageid: 12,
                title: "NVIDIA",
                extract: "A provider-returned company description.",
              },
            },
          },
        });
      return json({});
    },
  });
  await new Promise(setImmediate);
  expect(urls.filter((url) => url.includes("wikipedia")).length).toBe(1);
  expect(urls.length).toBe(4);
  expect(signals.every((signal) => signal === signals[0])).toBeTruthy();
  finishFinancials!(
    json({
      timeseries: {
        result: [series("annualTotalRevenue", [fact(50, "2025-12-31")])],
      },
    }),
  );
  const result = await operation;
  expect(result.profile!.description).toBe(
    "A provider-returned company description.",
  );
  expect(result.fundamentals.length).toBe(1);
});
