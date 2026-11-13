import { describe, expect, test } from "vitest";
import {
  jupiterPriceSchema,
  jupiterTokenSchema,
  precision,
  prestocksMetricSchema,
  xstocksNodeSchema,
} from "./schemas";

describe("provider schemas degrade instead of throwing", () => {
  test.each([undefined, null, 5, "x", [], true])(
    "xStocks node from %j",
    (input) => {
      expect(xstocksNodeSchema.parse(input)).toMatchObject({
        symbol: "",
        name: "",
        logo: null,
        isTradingHalted: false,
        deployments: [],
      });
    },
  );

  test("xStocks node keeps valid fields and ignores wrong-typed ones", () => {
    const node = xstocksNodeSchema.parse({
      symbol: "Ax",
      name: 7,
      logo: "http://insecure.example/a.png",
      isTradingHalted: "yes",
      underlying: { symbol: "A", type: "ETF" },
      deployments: [{ address: "m", network: "Solana" }, null, { address: 3 }],
    });
    expect(node).toMatchObject({
      symbol: "Ax",
      name: "",
      logo: null,
      isTradingHalted: false,
    });
    expect(node.underlying).toEqual({ symbol: "A", type: "ETF" });
    expect(node.deployments).toEqual([
      { address: "m", network: "Solana" },
      { address: "", network: undefined },
      { address: "", network: undefined },
    ]);
    expect(
      xstocksNodeSchema.parse({ isTradingHalted: true }).isTradingHalted,
    ).toBe(true);
    expect(
      xstocksNodeSchema.parse({ logo: "https://ok.example/a.png" }).logo,
    ).toBe("https://ok.example/a.png");
  });

  test("PreStocks metric reads positive prices only", () => {
    expect(
      prestocksMetricSchema.parse({
        splMint: "m",
        symbol: "S",
        tokenPrice: 2,
        marketCapUSD: 5,
      }),
    ).toEqual({
      splMint: "m",
      symbol: "S",
      tokenPrice: 2,
      marketCapUSD: 5,
    });
    expect(
      prestocksMetricSchema.parse({ tokenPrice: 0, marketCapUSD: "5" }),
    ).toMatchObject({ tokenPrice: null, marketCapUSD: null });
  });

  test("Jupiter token item maps every optional metric to null when absent or invalid", () => {
    expect(jupiterTokenSchema.parse({})).toMatchObject({
      id: "",
      decimals: null,
      usdPrice: null,
      priceBlockId: null,
      liquidity: null,
      mcap: null,
      updatedAt: null,
      stats24h: { priceChange: null, buyVolume: null, sellVolume: null },
    });
    const token = jupiterTokenSchema.parse({
      id: "m",
      usdPrice: 3,
      liquidity: -1,
      updatedAt: "not a date",
      stats24h: { priceChange: -2, buyVolume: 1, sellVolume: "2" },
    });
    expect(token).toMatchObject({
      id: "m",
      usdPrice: 3,
      liquidity: null,
      updatedAt: null,
    });
    expect(token.stats24h).toEqual({
      priceChange: -2,
      buyVolume: 1,
      sellVolume: null,
    });
  });

  test("Jupiter price entry carries stockData only when typed correctly", () => {
    expect(jupiterPriceSchema.parse(undefined).stockData).toEqual({
      id: undefined,
      price: null,
      updatedAt: null,
      mcap: null,
    });
    const value = jupiterPriceSchema.parse({
      usdPrice: 4,
      blockId: 9,
      stockData: {
        id: "xstocks",
        price: 5,
        updatedAt: "2026-09-12T12:00:00Z",
        mcap: 7,
      },
    });
    expect(value).toMatchObject({ usdPrice: 4, blockId: 9 });
    expect(value.stockData).toEqual({
      id: "xstocks",
      price: 5,
      updatedAt: "2026-09-12T12:00:00Z",
      mcap: 7,
    });
  });
});

describe("precision", () => {
  test.each([
    [0, 0],
    [8, 8],
    [18, 18],
    [19, null],
    [-1, null],
    [1.5, null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(precision(input)).toBe(expected);
  });
});
