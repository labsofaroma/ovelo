import { expect, test } from "vitest";
import {
  calculateResearchTechnicals,
  getStockResearch as loadResearch,
} from "./index";

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
const dailyBars = (values: number[]) =>
  values.map((close, index) => ({
    date: new Date(now - (values.length - index) * 86400000).toISOString(),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
  }));
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

test("computes Wilder RSI and moving averages; insufficient history remains null", () => {
  const rising = calculateResearchTechnicals(
    dailyBars(Array.from({ length: 220 }, (_, index) => 10 + index)),
    "https://provider.example/history",
  );
  expect(rising!.rsi14).toBe(100);
  expect(rising!.sma20).toBe(219.5);
  expect(rising!.sma50).toBe(204.5);
  expect(rising!.sma200).toBe(129.5);
  expect(rising!.averageVolume20).toBe(309.5);
  expect(rising!.trend).toBe("above-50-day");
  const mixed = calculateResearchTechnicals(
    dailyBars([
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ]),
    "",
  );
  expect(Math.abs(mixed!.rsi14! - 70.46413502109705) < 1e-9).toBeTruthy();
  expect(
    calculateResearchTechnicals(dailyBars(Array(20).fill(10)), "")!.rsi14,
  ).toBe(50);
  expect(
    calculateResearchTechnicals(
      dailyBars(Array.from({ length: 20 }, (_, index) => 30 - index)),
      "",
    )!.rsi14,
  ).toBe(0);
  const short = calculateResearchTechnicals(dailyBars([10, 11, 12]), "");
  expect(short!.rsi14).toBe(null);
  expect(short!.sma20).toBe(null);
  expect(short!.sma200).toBe(null);
  expect(short!.averageVolume20).toBe(null);
  expect(short!.high52w).toBe(null);
  expect(short!.low52w).toBe(null);
  expect(calculateResearchTechnicals([], "")).toBe(null);
});

test("52-week ranges require a full calendar span and enough observed trading sessions", () => {
  const observations = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(now - (365 - index) * 86400000);
    return { date, close: 100 + index };
  }).filter(({ date }) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6);
  const bars = observations.map(({ date, close }) => ({
    date: date.toISOString(),
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
  const complete = calculateResearchTechnicals(bars, "");
  expect(complete!.high52w).toBe(Math.max(...bars.map((bar) => bar.high)));
  expect(complete!.low52w).toBe(Math.min(...bars.map((bar) => bar.low)));
  const sparse = calculateResearchTechnicals(
    bars.filter((_, index) => index % 2 === 0),
    "",
  );
  expect(sparse!.high52w).toBe(null);
  expect(sparse!.low52w).toBe(null);
  const shortSpan = calculateResearchTechnicals(
    dailyBars(Array(220).fill(10)),
    "",
  );
  expect(shortSpan!.high52w).toBe(null);
  expect(shortSpan!.low52w).toBe(null);
});

test("daily close research excludes an open session and keeps it only after its verified end", async () => {
  const timestamps = ["2026-09-10T13:30:00Z", "2026-09-11T13:30:00Z"].map(
    (date) => Date.parse(date) / 1000,
  );
  const regular = {
    start: timestamps[1],
    end: Date.parse("2026-09-11T20:00:00Z") / 1000,
  };
  const run = async (at: string, includeSession = true) =>
    getStockResearch(asset, {
      now: () => Date.parse(at),
      fetcher: async (input: unknown) => {
        if (!String(input).includes("/chart/")) return json({});
        return json({
          chart: {
            result: [
              {
                meta: {
                  symbol: "NVDA",
                  instrumentType: "EQUITY",
                  exchangeTimezoneName: "America/New_York",
                  ...(includeSession
                    ? { currentTradingPeriod: { regular } }
                    : {}),
                },
                timestamp: timestamps,
                indicators: {
                  quote: [
                    {
                      open: [10, 20],
                      high: [12, 22],
                      low: [9, 19],
                      close: [11, 21],
                      volume: [100, 200],
                    },
                  ],
                },
              },
            ],
          },
        });
      },
    });
  const open = await run("2026-09-11T15:00:00Z");
  expect(open.bars.length).toBe(1);
  expect(open.technicals!.close).toBe(11);
  expect(open.technicals!.asOf).toBe("2026-09-10T13:30:00.000Z");
  const closed = await run("2026-09-11T20:01:00Z");
  expect(closed.bars.length).toBe(2);
  expect(closed.technicals!.close).toBe(21);
  const unverified = await run("2026-09-11T20:01:00Z", false);
  expect(unverified.bars.length).toBe(1);
  expect(unverified.technicals!.close).toBe(11);
});

test("preserves reported currency, periods and zero values; discards malformed bars and unrelated news", async () => {
  const result = await getStockResearch(asset, {
    now: () => now,
    fetcher: async (input: unknown) => {
      const url = String(input);
      if (url.includes("/chart/")) return json(chart());
      if (url.includes("/finance/search"))
        return json({
          quotes: [
            {
              symbol: "NVDA",
              longname: "NVIDIA Corporation",
              quoteType: "EQUITY",
              sector: "Technology",
            },
          ],
          news: [
            {
              title: "Company update",
              link: "https://publisher.example/article",
              providerPublishTime: 1789045200,
              publisher: "Publisher",
              relatedTickers: ["NVDA"],
            },
            {
              title: "Other company",
              link: "https://publisher.example/other",
              providerPublishTime: 1789045200,
              relatedTickers: ["AAPL"],
            },
            {
              title: "Unsafe link",
              link: "javascript:alert(1)",
              providerPublishTime: 1789045200,
              relatedTickers: ["NVDA"],
            },
          ],
        });
      if (url.includes("/timeseries/"))
        return json({
          timeseries: {
            result: [
              series("annualTotalRevenue", [
                fact(50, "2024-12-31"),
                fact(100, "2025-12-31", "EUR"),
                fact(500, "2030-12-31"),
              ]),
              series("annualNetIncome", [fact(0, "2025-12-31", "EUR")]),
              series("annualDilutedEPS", [fact(1.25, "2025-12-31", "EUR")]),
              series("quarterlyTotalRevenue", [
                fact(30, "2026-03-31", "EUR", "3M"),
                fact(60, "2026-06-30", "EUR", "6M"),
              ]),
              series("annualTotalDebt", [fact(5, "2025-12-31")], "AAPL"),
            ],
          },
        });
      return json({ query: { search: [] } });
    },
  });
  expect(result.status).toBe("available");
  expect(
    result.fundamentals.filter((item) => item.id === "annualTotalRevenue")
      .length,
  ).toBe(2);
  expect(result.bars.length).toBe(2);
  expect(result.technicals!.close).toBe(12);
  expect(
    result.fundamentals.find((item) => item.id === "annualTotalRevenue")!.value,
  ).toBe(100);
  expect(
    result.fundamentals.find((item) => item.id === "annualTotalRevenue")!.unit,
  ).toBe("EUR");
  expect(
    result.fundamentals.find((item) => item.id === "annualTotalRevenue")!
      .periodEnd,
  ).toBe("2025-12-31");
  expect(
    result.fundamentals.find((item) => item.id === "annualNetIncome")!.value,
  ).toBe(0);
  expect(
    result.fundamentals.find((item) => item.id === "annualDilutedEPS")!.unit,
  ).toBe("EUR/share");
  expect(
    result.fundamentals.find((item) => item.id === "quarterlyTotalRevenue")!
      .periodEnd,
  ).toBe("2026-03-31");
  expect(
    result.fundamentals.some((item) => item.id === "annualTotalDebt"),
  ).toBe(false);
  expect(result.news.length).toBe(1);
  expect(result.events.length).toBe(2);
  expect(result.events[0]!.detail).toMatch(/underlying share/);
  expect(result.profile!.sector).toBe("Technology");
});

test("never attaches mismatched symbols or unrelated encyclopedia results to the company", async () => {
  const requests: string[] = [];
  const result = await getStockResearch(asset, {
    now: () => now,
    fetcher: async (input: unknown) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/chart/")) return json(chart("AAPL"));
      if (url.includes("/finance/search"))
        return json({
          quotes: [
            { symbol: "AAPL", longname: "Apple Inc.", quoteType: "EQUITY" },
          ],
        });
      if (url.includes("/timeseries/"))
        return json({
          timeseries: {
            result: [series("annualTotalRevenue", [fact(100, "2025-12-31")])],
          },
        });
      return json({
        query: { search: [{ title: "Some other corporation", pageid: 100 }] },
      });
    },
  });
  expect(result.profile).toBe(null);
  expect(result.bars.length).toBe(0);
  expect(result.fundamentals.length).toBe(0);
  expect(result.status).toBe("unavailable");
  expect(requests.some((url) => url.includes("wikipedia"))).toBe(false);
});

test("private companies do not query a coincidentally matching public stock ticker", async () => {
  const requests: string[] = [];
  const result = await getStockResearch(
    {
      ...asset,
      underlyingSymbol: "OPENAI",
      name: "OpenAI",
      issuer: "prestocks",
      kind: "pre-ipo",
    },
    {
      now: () => now,
      fetcher: async (input: unknown) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("news.google.com"))
          return new Response(
            "<rss><channel><item><title>OpenAI update - Publisher</title><link>https://publisher.example/openai</link><source>Publisher</source><pubDate>Fri, 11 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>",
          );
        return json({
          query: {
            pages: {
              42: {
                pageid: 42,
                title: "OpenAI",
                extract: "A provider-returned company description.",
              },
            },
          },
        });
      },
    },
  );
  expect(result.status).toBe("partial");
  expect(requests.some((url) => url.includes("finance.yahoo.com"))).toBe(false);
  expect(result.bars.length).toBe(0);
  expect(result.fundamentals.length).toBe(0);
  expect(result.news[0]!.title).toBe("OpenAI update");
  expect(result.profile!.name).toBe("OpenAI");
  expect(result.profile!.exchange).toBe(null);
});
