import { afterEach, describe, expect, test, vi } from "vitest";
import type { MarketAsset } from "../markets";
import { hydratePythPrices, PythHermesClient } from "./hermes";
import { XSTOCKS_PYTH_FEEDS } from "./feeds";
import { PythOracleError } from "./types";
import { fetchXStocksOracles } from "./xstocks";

const NVDA = XSTOCKS_PYTH_FEEDS.NVDA!;
const ID = "a".repeat(64);

function mockFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const spy = vi.fn(async (input: URL | string, init?: RequestInit) =>
    handler(new URL(String(input)), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PythHermesClient.getLatestPrices", () => {
  test("scales price and confidence by the exponent, 0x-prefixes ids, and sends the key", async () => {
    const fetchSpy = mockFetch(() =>
      json({
        parsed: [
          {
            id: ID,
            price: {
              price: "12345",
              conf: "10",
              expo: -2,
              publish_time: 1_700_000_000,
            },
          },
        ],
      }),
    );
    const client = new PythHermesClient("https://hermes.example/", "secret");
    const [price] = await client.getLatestPrices([ID, `0x${"b".repeat(64)}`]);
    expect(price).toMatchObject({
      feedId: `0x${ID}`,
      price: 123.45,
      confidence: 0.1,
      expo: -2,
      rawPrice: "12345",
      status: "trading",
    });
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.origin).toBe("https://hermes.example");
    expect(url.searchParams.getAll("ids[]")).toEqual([
      `0x${ID}`,
      `0x${"b".repeat(64)}`,
    ]);
    expect(
      (fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer secret");
  });

  test("returns nothing for empty input, HTTP errors, malformed bodies, network failures and non-positive prices", async () => {
    const client = new PythHermesClient("https://hermes.example", "k");
    expect(await client.getLatestPrices([])).toEqual([]);
    for (const response of [
      () => json({}, 500),
      () => json({ nope: 1 }),
      () => json("x"),
      () => {
        throw new Error("offline");
      },
    ]) {
      mockFetch(response);
      expect(await client.getLatestPrices([ID])).toEqual([]);
    }
    mockFetch(() =>
      json({
        parsed: [
          null,
          { id: 5, price: {} },
          { id: ID },
          {
            id: ID,
            price: { price: "0", conf: "1", expo: 0, publish_time: 1 },
          },
          {
            id: ID,
            price: { price: "-5", conf: "1", expo: 0, publish_time: 1 },
          },
          {
            id: ID,
            price: { price: "abc", conf: "1", expo: 0, publish_time: 1 },
          },
        ],
      }),
    );
    expect(await client.getLatestPrices([ID])).toEqual([]);
  });

  test("falls back to PYTH_API_KEY from the environment", () => {
    vi.stubEnv("PYTH_API_KEY", "from-env");
    expect(new PythHermesClient().apiKey).toBe("from-env");
    expect(new PythHermesClient("https://x/", "explicit").apiKey).toBe(
      "explicit",
    );
    expect(new PythHermesClient("https://x///").baseUrl).toBe("https://x//");
  });
});

describe("PythHermesClient.searchFeeds and getFeedDetails", () => {
  const feed = (id: string, symbol: string) => ({ id, attributes: { symbol } });

  test("keeps only well-formed feeds and passes query and asset type", async () => {
    const fetchSpy = mockFetch(() =>
      json([
        feed(ID, "Crypto.NVDAX/USD"),
        feed("short", "x"),
        { id: ID },
        null,
        { id: ID, attributes: { symbol: 4 } },
      ]),
    );
    const client = new PythHermesClient("https://hermes.example", "k");
    const feeds = await client.searchFeeds("NVDAX", "crypto");
    expect(feeds).toHaveLength(1);
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.searchParams.get("query")).toBe("NVDAX");
    expect(url.searchParams.get("asset_type")).toBe("crypto");
  });

  test("throws PythOracleError for HTTP errors, non-array bodies and network failures", async () => {
    const client = new PythHermesClient("https://hermes.example", "k");
    mockFetch(
      () => new Response("no", { status: 503, statusText: "Unavailable" }),
    );
    await expect(client.searchFeeds("x")).rejects.toThrow(/503 Unavailable/);
    mockFetch(() => json({ not: "array" }));
    await expect(client.searchFeeds("x")).rejects.toThrow(
      /invalid feed metadata/,
    );
    mockFetch(() => {
      throw new Error("offline");
    });
    await expect(client.searchFeeds("x")).rejects.toBeInstanceOf(
      PythOracleError,
    );
  });

  test("getFeedDetails matches only the exact Crypto.<SYMBOL>X/USD feed", async () => {
    const client = new PythHermesClient("https://hermes.example", "k");
    mockFetch(() =>
      json([
        feed(ID, "Crypto.NVDAX/USD.OTHER"),
        feed("b".repeat(64), "Crypto.NVDAX/USD"),
      ]),
    );
    expect((await client.getFeedDetails("nvda"))?.id).toBe("b".repeat(64));
    mockFetch(() => json([feed(ID, "Crypto.AMZNX/USD")]));
    expect(await client.getFeedDetails("NVDA")).toBeNull();
  });
});

describe("hydratePythPrices", () => {
  const asset = (symbol: string): MarketAsset =>
    ({ symbol, underlyingSymbol: symbol }) as unknown as MarketAsset;

  test("does nothing when no asset has a feed, without calling the network", async () => {
    const fetchSpy = mockFetch(() => json({}));
    expect(await hydratePythPrices([asset("ZZZZ")])).toEqual({
      count: 0,
      source: "none",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("writes real quotes onto matching assets and reports the source", async () => {
    mockFetch(() =>
      json({
        parsed: [
          {
            id: NVDA.equityReferenceFeedId.slice(2),
            price: {
              price: "90000",
              conf: "5",
              expo: -2,
              publish_time: 1_700_000_000,
            },
          },
        ],
      }),
    );
    const nvda = asset("NVDA");
    const other = asset("ZZZZ");
    const result = await hydratePythPrices([nvda, other], {
      hermesBaseUrl: "https://hermes.example",
      hermesApiKey: "k",
    });
    expect(result).toEqual({ count: 1, source: "Pyth Network Oracles" });
    expect(nvda).toMatchObject({
      underlyingPriceUsd: 900,
      underlyingPriceSource: "pyth",
      isRealTimePyth: true,
      underlyingConfidenceUsd: 0.05,
    });
    expect(nvda.underlyingPriceUpdatedAt).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
    expect(other.underlyingPriceUsd).toBeUndefined();
  });

  test("reports no hydration when Hermes returns nothing", async () => {
    mockFetch(() => json({ parsed: [] }));
    expect(
      await hydratePythPrices([asset("NVDA")], { hermesApiKey: "k" }),
    ).toEqual({ count: 0, source: "none" });
  });
});

describe("fetchXStocksOracles", () => {
  test("refuses missing, non-https and credentialed URLs without fetching", async () => {
    const fetchSpy = mockFetch(() => json([]));
    expect(await fetchXStocksOracles()).toEqual([]);
    expect(await fetchXStocksOracles("http://oracle.example")).toEqual([]);
    expect(await fetchXStocksOracles("https://user:pw@oracle.example")).toEqual(
      [],
    );
    expect(await fetchXStocksOracles("not a url")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("accepts an array or { oracles } and filters invalid records", async () => {
    const good = { symbol: "NVDAx", feedId: ID, price: 10 };
    const records = [
      good,
      { symbol: "A" },
      { symbol: 1 },
      { symbol: "B", feedId: "bad" },
      { symbol: "C", price: -1 },
      { symbol: "D", price: "9" },
      null,
    ];
    mockFetch(() => json(records));
    expect(await fetchXStocksOracles("https://oracle.example")).toEqual([
      good,
      { symbol: "A" },
    ]);
    mockFetch(() => json({ oracles: [good] }));
    expect(await fetchXStocksOracles("https://oracle.example")).toEqual([good]);
  });

  test("returns nothing for HTTP errors, unexpected shapes and network failures", async () => {
    mockFetch(() => json({}, 500));
    expect(await fetchXStocksOracles("https://oracle.example")).toEqual([]);
    mockFetch(() => json({ other: 1 }));
    expect(await fetchXStocksOracles("https://oracle.example")).toEqual([]);
    mockFetch(() => {
      throw new Error("offline");
    });
    expect(await fetchXStocksOracles("https://oracle.example")).toEqual([]);
  });
});
