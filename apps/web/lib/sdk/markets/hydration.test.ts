import { expect, test } from "vitest";
import {
  getMainnetCatalog,
  getMainnetMarkets,
  type MarketSnapshot,
} from "./index";

const partialSnapshot = (value: unknown) => value as MarketSnapshot;

// Provider fixtures are only used in tests, never shipped as fallback market data.
const mintA = "11111111111111111111111111111111";
const mintB = "22222222222222222222222222222222";
const mintP = "33333333333333333333333333333333";
const j = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

test("Price V3 recovers token quotes without using underlying references as trade prices", async () => {
  const fetcher = async (input: unknown) => {
    if (String(input).includes("api.backpack.exchange")) return j([]);
    const url = String(input);
    if (url.includes("xstocks.fi"))
      return j({
        nodes: [
          {
            symbol: "Ax",
            name: "A",
            deployments: [{ network: "Solana", address: mintA }],
          },
          {
            symbol: "Bx",
            name: "B",
            deployments: [{ network: "Solana", address: mintB }],
          },
        ],
        page: { hasNextPage: false },
      });
    if (url.endsWith("/products")) return new Response("");
    if (url.endsWith("/api/metrics")) return j({ metrics: [] });
    if (url.includes("/tokens/v2/"))
      return j([
        { id: mintA, stats24h: { buyVolume: 5, sellVolume: 10 } },
        { id: mintB },
      ]);
    expect(url.includes("/price/v3?ids=")).toBeTruthy();
    return j({
      [mintA]: {
        usdPrice: 125,
        decimals: 8,
        blockId: 12345,
        priceChange24h: -2,
        liquidity: 500,
        stockData: {
          id: "xstocks",
          price: 124,
          mcap: 1000000,
          updatedAt: "2026-09-12T12:00:00Z",
        },
      },
      [mintB]: {
        decimals: 8,
        stockData: {
          id: "xstocks",
          price: 40,
          mcap: 400000,
          updatedAt: "2026-09-12T12:00:00Z",
        },
      },
      [mintP]: { usdPrice: 999 },
    });
  };
  const snapshot = await getMainnetMarkets({ fetcher });
  const a = snapshot.assets.find((asset) => asset.mint === mintA)!;
  const b = snapshot.assets.find((asset) => asset.mint === mintB)!;
  expect(a.priceUsd).toBe(125);
  expect(a.priceSource).toBe("jupiter-price-v3");
  expect(a.priceBlockId).toBe(12345);
  expect(a.change24hPct).toBe(-2);
  expect(a.volume24hUsd).toBe(15);
  expect(a.underlyingPriceUsd).toBe(124);
  expect(a.underlyingMarketCapUsd).toBe(1000000);
  expect(a.marketCapUsd).toBe(null);
  expect(b.priceUsd).toBe(null);
  expect(b.priceObservedAt).toBe(null);
  expect(b.underlyingPriceUsd).toBe(40);
  expect(b.decimals).toBe(8);
  expect(snapshot.assets.length).toBe(2);
});

test("price requests respect 50-mint limit and retain Tokens V2 prices during a V3 outage", async () => {
  const mints = Array.from(
    { length: 101 },
    (_, i) => "1".repeat(30) + String(i + 100).replaceAll("0", "a"),
  );
  const priceBatches: string[][] = [];
  const fetcher = async (input: unknown) => {
    if (String(input).includes("api.backpack.exchange")) return j([]);
    const url = new URL(String(input));
    if (url.hostname === "api.xstocks.fi")
      return j({
        nodes: mints.map((mint, index) => ({
          symbol: `T${index}x`,
          name: `Token ${index}`,
          deployments: [{ network: "Solana", address: mint }],
        })),
        page: { hasNextPage: false },
      });
    if (url.pathname === "/products") return new Response("");
    if (url.pathname === "/api/metrics") return j({ metrics: [] });
    if (url.pathname === "/tokens/v2/search")
      return j(
        url.searchParams
          .get("query")!
          .split(",")
          .map((id) => ({ id, usdPrice: 10, decimals: 8 })),
      );
    priceBatches.push(url.searchParams.get("ids")!.split(","));
    return new Response("", { status: 503 });
  };
  const snapshot = await getMainnetMarkets({ fetcher });
  expect(snapshot.assets.length).toBe(101);
  expect(
    snapshot.assets.every(
      (asset) =>
        asset.priceUsd === 10 && asset.priceSource === "jupiter-tokens-v2",
    ),
  ).toBeTruthy();
  expect(priceBatches.map((batch) => batch.length)).toEqual([50, 50, 1]);
  expect(snapshot.status).toBe("partial");
});

test("retries a rate-limited price batch using the provider reset window", async () => {
  let priceCalls = 0;
  const startedAt = Date.now();
  const fetcher = async (input: unknown) => {
    if (String(input).includes("api.backpack.exchange")) return j([]);
    const url = String(input);
    if (url.includes("xstocks.fi"))
      return j({
        nodes: [
          {
            symbol: "Ax",
            name: "A",
            deployments: [{ network: "Solana", address: mintA }],
          },
        ],
        page: { hasNextPage: false },
      });
    if (url.endsWith("/products")) return new Response("");
    if (url.endsWith("/api/metrics")) return j({ metrics: [] });
    if (url.includes("/tokens/v2/")) return j([{ id: mintA }]);
    if (priceCalls++ === 0)
      return new Response("", {
        status: 429,
        headers: { "x-ratelimit-reset": String((Date.now() + 100) / 1000) },
      });
    return j({ [mintA]: { usdPrice: 25, decimals: 8 } });
  };
  const snapshot = await getMainnetMarkets({ fetcher });
  expect(priceCalls).toBe(2);
  expect(Date.now() - startedAt >= 100).toBeTruthy();
  expect(snapshot.assets[0]!.priceUsd).toBe(25);
  expect(snapshot.assets[0]!.priceSource).toBe("jupiter-price-v3");
});

test("request cancellation stops quota waiting and preserves completed token quotes", async () => {
  const controller = new AbortController();
  let priceCalls = 0;
  const fetcher = async (input: unknown) => {
    if (String(input).includes("api.backpack.exchange")) return j([]);
    const url = String(input);
    if (url.includes("xstocks.fi"))
      return j({
        nodes: [
          {
            symbol: "Ax",
            name: "A",
            deployments: [{ network: "Solana", address: mintA }],
          },
        ],
        page: { hasNextPage: false },
      });
    if (url.endsWith("/products")) return new Response("");
    if (url.endsWith("/api/metrics")) return j({ metrics: [] });
    if (url.includes("/tokens/v2/")) return j([{ id: mintA, usdPrice: 25 }]);
    priceCalls++;
    setTimeout(() => controller.abort(), 10);
    return new Response("", { status: 429, headers: { "retry-after": "10" } });
  };
  const snapshot = await getMainnetMarkets({
    fetcher,
    signal: controller.signal,
  });
  expect(priceCalls).toBe(1);
  expect(snapshot.assets[0]!.priceUsd).toBe(25);
  expect(snapshot.status).toBe("partial");
});

test("issuer-only discovery performs no Jupiter requests", async () => {
  const requested: string[] = [];
  const catalog = await getMainnetCatalog({
    fetcher: async (input: unknown) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("xstocks.fi"))
        return j({
          nodes: [
            {
              symbol: "Ax",
              name: "Issuer A",
              deployments: [{ network: "Solana", address: mintA }],
            },
          ],
          page: { hasNextPage: false },
        });
      if (url.endsWith("/products")) return new Response("");
      if (url.endsWith("/api/metrics")) return j({ metrics: [] });
      throw new Error("Price lookup must not be needed to identify an asset");
    },
  });
  expect(catalog.assets[0]!.mint).toBe(mintA);
  expect(catalog.assets[0]!.priceUsd).toBe(null);
  expect(requested.every((url) => !url.includes("jup.ag"))).toBeTruthy();
});

test("token observations publish before blocked references and remain detached", async () => {
  const asset = {
    mint: mintA,
    symbol: "Ax",
    underlyingSymbol: "A",
    issuer: "xstocks",
    priceUsd: null,
    verified: true,
    tradingHalted: false,
  };
  const catalog = partialSnapshot({
    assets: [asset],
    baskets: [],
    asOf: new Date().toISOString(),
    network: "mainnet-beta",
    sources: ["xStocks issuer catalog"],
    warnings: [],
    status: "live",
  });
  let finishPrice!: () => void;
  const priceReady = new Promise<void>((resolve) => {
    finishPrice = resolve;
  });
  let coreReady!: (snapshot: MarketSnapshot) => void;
  const core = new Promise<MarketSnapshot>((resolve) => {
    coreReady = resolve;
  });
  const task = getMainnetMarkets({
    catalog,
    onUpdate: coreReady,
    fetcher: async (input: unknown) => {
      if (String(input).includes("/tokens/v2/"))
        return j([{ id: mintA, usdPrice: 12, decimals: 8 }]);
      await priceReady;
      return j({
        [mintA]: {
          usdPrice: 13,
          stockData: {
            id: "xstocks",
            price: 14,
            updatedAt: "2026-09-12T12:00:00Z",
          },
        },
      });
    },
  });
  const early = await core;
  expect(early.assets[0]!.priceUsd).toBe(12);
  expect(asset.priceUsd, "caller-owned catalog is unchanged").toBe(null);
  finishPrice();
  const complete = await task;
  expect(complete.assets[0]!.priceUsd).toBe(13);
  expect(complete.assets[0]!.underlyingPriceUsd).toBe(14);
  expect(
    early.assets[0]!.priceUsd,
    "later enrichment does not mutate the published response",
  ).toBe(12);
  expect(early.assets[0]!.underlyingPriceUsd).toBe(undefined);
});
