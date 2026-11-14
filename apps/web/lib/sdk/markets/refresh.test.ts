import { expect, test } from "vitest";
import { getMainnetMarkets, type MarketSnapshot } from "./index";

const partialSnapshot = (value: unknown) => value as MarketSnapshot;

// Provider fixtures are only used in tests, never shipped as fallback market data.
const mintA = "11111111111111111111111111111111";
const mintB = "22222222222222222222222222222222";
const j = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

test("frequent token refreshes can omit the supplemental reference batches", async () => {
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
  const calls = [];
  const result = await getMainnetMarkets({
    catalog,
    includePriceReferences: false,
    fetcher: async (input: unknown) => {
      calls.push(String(input));
      expect(String(input).includes("/tokens/v2/")).toBeTruthy();
      return j([{ id: mintA, usdPrice: 20, decimals: 8 }]);
    },
  });
  expect(calls.length).toBe(1);
  expect(result.assets[0]!.priceUsd).toBe(20);
  expect(result.assets[0]!.priceSource).toBe("jupiter-tokens-v2");
});

test("token quotes available only through V3 still refresh between full reference passes", async () => {
  const assets = [mintA, mintB].map((mint, index) => ({
    mint,
    symbol: `T${index}x`,
    underlyingSymbol: `T${index}`,
    issuer: "xstocks",
    priceUsd: null,
    verified: true,
    tradingHalted: false,
  }));
  const catalog = partialSnapshot({
    assets,
    baskets: [],
    asOf: new Date().toISOString(),
    network: "mainnet-beta",
    sources: ["xStocks issuer catalog"],
    warnings: [],
    status: "live",
  });
  const priceCalls: (string | null)[] = [];
  const result = await getMainnetMarkets({
    catalog,
    includePriceReferences: false,
    priceFallbackMints: [mintA, mintB],
    fetcher: async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/tokens/"))
        return j([{ id: mintA, usdPrice: 12 }]);
      priceCalls.push(url.searchParams.get("ids"));
      return j({
        [mintB]: {
          usdPrice: 15,
          stockData: {
            id: "xstocks",
            price: 99,
            updatedAt: "2026-09-12T12:00:00Z",
          },
        },
      });
    },
  });
  expect(
    priceCalls,
    "already refreshed Tokens V2 mints do not need duplicate V3 price requests",
  ).toEqual([mintB]);
  expect(result.assets.find((asset) => asset.mint === mintB)!.priceUsd).toBe(
    15,
  );
  expect(result.assets.find((asset) => asset.mint === mintB)!.priceSource).toBe(
    "jupiter-price-v3",
  );
});

test("safely resolves comma-separated jupiterApiKey strings into individual clean headers", async () => {
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
  const capturedKeys: (string | undefined)[] = [];
  await getMainnetMarkets({
    catalog,
    includePriceReferences: false,
    jupiterApiKey: "  jup_key1  ,  jup_key2  ",
    fetcher: async (_input, init) => {
      capturedKeys.push(
        (init?.headers as Record<string, string> | undefined)?.["x-api-key"],
      );
      return j([{ id: mintA, usdPrice: 50, decimals: 8 }]);
    },
  });
  expect(capturedKeys.length).toBe(1);
  expect(capturedKeys[0]).toBe("jup_key1");
});
