import { afterEach, describe, expect, test, vi } from "vitest";
import { loadConstituentHistoricalBars } from "./bars";
import { fetchBasketHistoricalPerformance } from "./history";

const DAY = 86_400;
const NOW = Date.parse("2026-06-30T12:00:00Z");
const nowOption = () => NOW;

/** Daily closes ending the day before NOW. Prices are sample values, never real quotes. */
function yahoo(closes: (number | null)[], days = closes.length) {
  const end = Math.floor(NOW / 1000 / DAY) * DAY;
  const timestamp = Array.from(
    { length: days },
    (_, i) => end - (days - i) * DAY + 3600,
  );
  return {
    chart: {
      result: [{ timestamp, indicators: { quote: [{ close: closes }] } }],
    },
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

/** Fetcher that serves a payload per requested Yahoo symbol and records the URLs. */
function fetcherFor(bySymbol: Record<string, unknown | (() => Response)>) {
  const urls: string[] = [];
  const fetcher = async (input: unknown): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const symbol = decodeURIComponent(url.split("/chart/")[1]!.split("?")[0]!);
    const entry = bySymbol[symbol];
    if (entry === undefined) return json({}, 404);
    return typeof entry === "function"
      ? (entry as () => Response)()
      : json(entry);
  };
  return { fetcher: fetcher as typeof fetch, urls };
}

const member = (
  symbol: string,
  weight: number,
  priceUsd: number | null = 100,
) => ({
  asset: {
    mint: `${symbol}-mint`,
    symbol: `${symbol}x`,
    underlyingSymbol: symbol,
    name: symbol,
    priceUsd,
  },
  weight,
});
const basket = (...members: ReturnType<typeof member>[]) => ({
  id: "sample",
  assets: members,
});

const series = (count: number, start: number, step: number) =>
  Array.from({ length: count }, (_, i) => start + i * step);

afterEach(() => vi.unstubAllGlobals());

describe("loadConstituentHistoricalBars", () => {
  test("keeps only positive finite closes, sorts by date and normalises the symbol", async () => {
    const { fetcher, urls } = fetcherFor({
      "BRK-B": yahoo([10, null, Number.NaN, 0, -3, 12, 11]),
    });
    const bars = await loadConstituentHistoricalBars("brk.b", { fetcher });
    expect(bars.map((b) => b.close)).toEqual([10, 12, 11]);
    expect([...bars].sort((a, b) => a.date.localeCompare(b.date))).toEqual(
      bars,
    );
    expect(urls[0]).toContain("/chart/BRK-B?range=1y&interval=1d");
  });

  test("strips issuer prefixes and returns [] for HTTP errors, empty results and network failures", async () => {
    const { fetcher } = fetcherFor({
      AAPL: () => json({}, 500),
      MSFT: { chart: { result: [] } },
    });
    expect(await loadConstituentHistoricalBars("xAAPL", { fetcher })).toEqual(
      [],
    );
    expect(await loadConstituentHistoricalBars("MSFT", { fetcher })).toEqual(
      [],
    );
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await loadConstituentHistoricalBars("NVDA", { fetcher: failing }),
    ).toEqual([]);
  });

  test("shares one request between concurrent callers and caches the result", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      calls.push(String(input));
      return json(yahoo([5, 6, 7]));
    });
    const [a, b] = await Promise.all([
      loadConstituentHistoricalBars("CACHEME"),
      loadConstituentHistoricalBars("cacheme"),
    ]);
    expect(a).toEqual(b);
    await loadConstituentHistoricalBars("CACHEME");
    expect(calls).toHaveLength(1);
  });

  test("an injected fetcher bypasses the shared cache", async () => {
    const { fetcher, urls } = fetcherFor({ BYPASS: yahoo([1, 2]) });
    await loadConstituentHistoricalBars("BYPASS", { fetcher });
    await loadConstituentHistoricalBars("BYPASS", { fetcher });
    expect(urls).toHaveLength(2);
  });
});

describe("fetchBasketHistoricalPerformance", () => {
  test("24h is computed from snapshot quotes without any network call", async () => {
    const { fetcher, urls } = fetcherFor({});
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("AAA", 10_000)),
      timeframe: "24h",
      options: { fetcher },
    });
    expect(result.timeframe).toBe("24h");
    expect(urls).toEqual([]);
  });

  test("a basket without members is unavailable with an explicit warning", async () => {
    const result = await fetchBasketHistoricalPerformance({
      basket: { id: "empty", assets: [] },
      timeframe: "30d",
      options: { now: nowOption },
    });
    expect(result).toMatchObject({
      basketId: "empty",
      status: "unavailable",
      changePct: null,
      history: [],
      constituents: [],
    });
    expect(result.warnings).toEqual(["Basket has no constituent assets."]);
    expect(
      (
        await fetchBasketHistoricalPerformance({
          basket: null,
          timeframe: "7d",
          options: { now: nowOption },
        })
      ).basketId,
    ).toBe("basket");
  });

  test("computes a normalised NAV, attribution, gain/loss and top mover for a live basket", async () => {
    const { fetcher } = fetcherFor({
      AAA: yahoo(series(40, 100, 1)), // +39% over the window
      BBB: yahoo(series(40, 100, -1)), // -39%
    });
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("AAA", 5000), member("BBB", 5000)),
      timeframe: "30d",
      baseAmountUsd: 2000,
      options: { fetcher, now: nowOption },
    });
    expect(result.status).toBe("live");
    expect(result.history[0]).toMatchObject({ value: 100, changePct: 0 });
    expect(result.history.length).toBeGreaterThan(20);
    expect(result.topGainer?.symbol).toBe("AAAx");
    expect(result.topLoser?.symbol).toBe("BBBx");
    expect(
      result.constituents.every(
        (c) => c.underlyingPriceSource === "yahoo-finance",
      ),
    ).toBe(true);
    expect(result.sources).toContain("Yahoo Finance Daily Closes");
    const last = result.history.at(-1)!;
    expect(result.changePct).toBe(last.changePct);
    expect(result.gainLossUsd).toBe(
      Number(((2000 * last.changePct) / 100).toFixed(2)),
    );
    expect(result.endValueUsd).toBe(
      Number((2000 + result.gainLossUsd!).toFixed(2)),
    );
    expect(result.asOf).toBe(new Date(NOW).toISOString());
  });

  test.each(["7d", "30d", "90d", "1y", "ytd"] as const)(
    "%s window only uses dates inside its cutoff",
    async (timeframe) => {
      const { fetcher } = fetcherFor({
        AAA: yahoo(series(300, 50, 0.1)),
        BBB: yahoo(series(300, 80, 0.2)),
      });
      const result = await fetchBasketHistoricalPerformance({
        basket: basket(member("AAA", 5000), member("BBB", 5000)),
        timeframe,
        options: { fetcher, now: nowOption },
      });
      const days = { "7d": 7, "30d": 30, "90d": 90, "1y": 365, ytd: 181 }[
        timeframe
      ];
      expect(result.history.length).toBeLessThanOrEqual(days + 1);
      expect(result.history.length).toBeGreaterThan(1);
      expect(result.timeframe).toBe(timeframe);
    },
  );

  test("a constituent without history makes the result partial, named in a warning, with no invented price", async () => {
    const { fetcher } = fetcherFor({ AAA: yahoo(series(40, 100, 1)) });
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("AAA", 5000), member("ZZZ", 5000, null)),
      timeframe: "30d",
      options: { fetcher, now: nowOption },
    });
    expect(result.status).toBe("partial");
    expect(result.warnings.join(" ")).toMatch(
      /1 of 2 constituents lacked historical price series/,
    );
    const missing = result.constituents.find((c) => c.symbol === "ZZZx")!;
    expect(missing).toMatchObject({
      changePct: null,
      contributionPct: null,
      startPriceUsd: null,
      currentPriceUsd: null,
    });
    expect(result.topLoser).toBeNull();
  });

  test("forward-fills days a constituent skips after its first observation", async () => {
    const gaps = series(40, 100, 1).map((value, i) =>
      i === 25 || i === 30 ? null : value,
    );
    const run = async (closes: (number | null)[]) => {
      const { fetcher } = fetcherFor({
        AAA: yahoo(series(40, 100, 1)),
        GAPPY: yahoo(closes),
      });
      return fetchBasketHistoricalPerformance({
        basket: basket(member("AAA", 5000), member("GAPPY", 5000)),
        timeframe: "30d",
        options: { fetcher, now: nowOption },
      });
    };
    const withGaps = await run(gaps);
    const complete = await run(series(40, 100, 1));
    expect(withGaps.history).toHaveLength(complete.history.length);
    expect(
      withGaps.constituents.find((c) => c.symbol === "GAPPYx")?.changePct,
    ).not.toBeNull();
  });

  test("never back-fills before a constituent's first observation", async () => {
    const late = series(40, 100, 1).map((value, i) => (i < 35 ? null : value));
    const { fetcher } = fetcherFor({
      AAA: yahoo(series(40, 100, 1)),
      LATE: yahoo(late),
    });
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("AAA", 5000), member("LATE", 5000, null)),
      timeframe: "30d",
      options: { fetcher, now: nowOption },
    });
    expect(result.constituents.find((c) => c.symbol === "LATEx")).toMatchObject(
      { startPriceUsd: null, changePct: null },
    );
    expect(result.status).toBe("partial");
  });

  test("falls back to 24h quotes and says so when every history request fails", async () => {
    const { fetcher } = fetcherFor({});
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("AAA", 10_000)),
      timeframe: "90d",
      options: { fetcher, now: nowOption },
    });
    expect(result.status).toBe("unavailable");
    expect(result.timeframe).toBe("90d");
    expect(result.warnings[0]).toMatch(
      /Historical daily bars are temporarily unavailable for timeframe 90D/,
    );
  });

  test("a single observed date is not enough to claim a period return", async () => {
    const { fetcher } = fetcherFor({ AAA: yahoo([100], 1) });
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("AAA", 10_000)),
      timeframe: "7d",
      options: { fetcher, now: nowOption },
    });
    expect(result.status).toBe("partial");
    expect(result.warnings[0]).toMatch(
      /Insufficient historical date observations for 7d/,
    );
  });

  test("lists Pyth reference feeds as a source when a constituent has one", async () => {
    const { fetcher } = fetcherFor({
      NVDA: yahoo(series(40, 100, 1)),
      AAA: yahoo(series(40, 100, 1)),
    });
    const result = await fetchBasketHistoricalPerformance({
      basket: basket(member("NVDA", 5000), member("AAA", 5000)),
      timeframe: "30d",
      options: { fetcher, now: nowOption },
    });
    expect(result.sources).toContain("Pyth Network Reference Feeds");
  });
});
