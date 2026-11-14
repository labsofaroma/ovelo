import { expect, test, vi } from "vitest";
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

test("coalesces cold loads and serves dated cache immediately while one refresh reuses slow-changing facts", async () => {
  let clock = now;
  let gate: Promise<unknown> | undefined = undefined;
  const calls: string[] = [];
  const symbol = "CACHEFLOW";
  const cachedAsset = {
    ...asset,
    mint: "cache-flow",
    underlyingSymbol: symbol,
  };
  vi.spyOn(Date, "now").mockImplementation((() => clock) as never);
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (gate) await gate;
    if (url.includes("/chart/")) {
      const value = chart(symbol);
      value.chart.result[0]!.meta.longName = "Cache Flow";
      return json(value);
    }
    if (url.includes("/timeseries/"))
      return json({
        timeseries: {
          result: [
            series("annualTotalRevenue", [fact(50, "2025-12-31")], symbol),
          ],
        },
      });
    if (url.includes("wikipedia"))
      return json({
        query: {
          pages: {
            12: {
              pageid: 12,
              title: "Cache Flow",
              extract: "A provider-returned company description.",
            },
          },
        },
      });
    return json({});
  }) as never);
  const [first, concurrent] = await Promise.all([
    getStockResearch(cachedAsset),
    getStockResearch(cachedAsset),
  ]);
  expect(first).toBe(concurrent);
  expect(first.refreshing).toBe(false);
  expect(calls.length).toBe(4);
  expect(await getStockResearch(cachedAsset)).toBe(first);
  expect(calls.length).toBe(4);

  clock += 5 * 60_000 + 1;
  let release;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  const refreshes: Promise<unknown>[] = [];
  const options = { waitUntil: (task: Promise<unknown>) => refreshes.push(task) };
  const stale = await getStockResearch(cachedAsset, options);
  const another = await getStockResearch(cachedAsset, options);
  expect(stale).toEqual({ ...first, refreshing: true });
  expect(another).toEqual(stale);
  expect(
    first.refreshing,
    "Already returned observations are not mutated",
  ).toBe(false);
  expect(stale.asOf).toBe(new Date(now).toISOString());
  expect(calls.length).toBe(6);
  expect(refreshes.length).toBe(2);
  release!();
  await Promise.all(refreshes);
  const refreshed = await getStockResearch(cachedAsset);
  expect(refreshed.asOf).toBe(new Date(clock).toISOString());
  expect(refreshed.refreshing).toBe(false);
  expect(calls.filter((url) => url.includes("/timeseries/")).length).toBe(1);
  expect(calls.filter((url) => url.includes("wikipedia")).length).toBe(1);
  expect(refreshed.fundamentals[0]!.periodEnd).toBe("2025-12-31");
});

test("research cache survives a short outage without extending observation dates and retries recovery", async () => {
  let clock = now;
  let offline = false;
  const symbol = "RECOVERY";
  const cachedAsset = { ...asset, mint: "recovery", underlyingSymbol: symbol };
  vi.spyOn(Date, "now").mockImplementation((() => clock) as never);
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
    if (offline) throw new Error("provider offline");
    if (String(input).includes("/chart/")) {
      const value = chart(symbol);
      value.chart.result[0]!.meta.longName = "Recovery Provider";
      return json(value);
    }
    if (String(input).includes("/timeseries/"))
      return json({
        timeseries: {
          result: [
            series("annualTotalRevenue", [fact(50, "2025-12-31")], symbol),
          ],
        },
      });
    return json({});
  }) as never);
  const first = await getStockResearch(cachedAsset);
  clock += 5 * 60_000 + 1;
  offline = true;
  const refreshes: Promise<unknown>[] = [];
  const stale = await getStockResearch(cachedAsset, {
    waitUntil: (task: Promise<unknown>) => refreshes.push(task),
  });
  expect(stale.asOf).toBe(first.asOf);
  expect(stale.refreshing).toBe(true);
  await Promise.all(refreshes);
  const retained = await getStockResearch(cachedAsset);
  expect(retained.asOf).toBe(first.asOf);
  expect(
    retained.refreshing,
    "A provider retry cooldown stops client polling",
  ).toBe(false);
  expect(retained.bars.length).toBe(first.bars.length);
  expect(retained.warnings.join(" ")).toMatch(/last observed research/);
  const cooldownTasks: Promise<unknown>[] = [];
  await getStockResearch(cachedAsset, {
    waitUntil: (task: Promise<unknown>) => cooldownTasks.push(task),
  });
  expect(cooldownTasks.length).toBe(0);

  clock += 30_001;
  offline = false;
  const recoveredTasks: Promise<unknown>[] = [];
  await getStockResearch(cachedAsset, {
    waitUntil: (task: Promise<unknown>) => recoveredTasks.push(task),
  });
  await Promise.all(recoveredTasks);
  const recovered = await getStockResearch(cachedAsset);
  expect(recovered.asOf).toBe(new Date(clock).toISOString());
  expect(recovered.refreshing).toBe(false);
  expect(
    recovered.warnings.some((warning) => warning.includes("last observed")),
  ).toBe(false);

  offline = true;
  clock += 15 * 60_000 + 1;
  const expired = await getStockResearch(cachedAsset);
  expect(expired.status).toBe("unavailable");
  expect(expired.refreshing).toBe(false);
  expect(expired.bars).toEqual([]);
  expect(expired.fundamentals).toEqual([]);
});
