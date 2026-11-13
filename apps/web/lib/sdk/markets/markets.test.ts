import { expect, test } from "vitest";
import {
  CANONICAL_BASKET_DEFINITIONS,
  getMainnetMarkets,
  resolveMarketBaskets,
  type MarketAsset,
} from "./index";

/** Fixtures set only the fields a test reads; the cast documents that they are partial. */
const partial = (value: Partial<MarketAsset>) => value as MarketAsset;

// Provider fixtures are only used in tests, never shipped as fallback market data.
const mintA = "11111111111111111111111111111111";
const mintB = "22222222222222222222222222222222";
const mintP = "33333333333333333333333333333333";
const j = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

test("paginates the issuer catalog, resolves only issuer mints and preserves unavailable data", async () => {
  const requested: string[] = [];
  const products = [
    {
      symbol: "PRIVATE",
      name: "Private Company",
      splMint: mintP,
      decimals: 9,
      skipPipeline: true,
    },
  ];
  const flight = "1:" + JSON.stringify({ products }) + "\n";
  const html = `<script nonce="example">self.__next_f.push(${JSON.stringify([1, flight])})</script>`;
  const fetcher = async (input: unknown) => {
    if (String(input).includes("api.backpack.exchange")) return j([]);
    const url = String(input);
    requested.push(url);
    if (url.includes("xstocks.fi"))
      return url.includes("page=0")
        ? j({
            nodes: [
              {
                symbol: "Ax",
                name: "Issuer A",
                underlying: { symbol: "A", type: "Equity" },
                deployments: [
                  { network: "Solana", address: mintA },
                  { network: "Ethereum", address: "0xwrong" },
                ],
              },
            ],
            page: { hasNextPage: true },
          })
        : j({
            nodes: [
              {
                symbol: "Bx",
                name: "Issuer B",
                deployments: [{ network: "Solana", address: mintB }],
              },
            ],
            page: { hasNextPage: false },
          });
    if (url.endsWith("/products")) return new Response(html);
    if (url.endsWith("/api/metrics"))
      return j({
        metrics: [{ symbol: "PRIVATE", splMint: mintP, tokenPrice: 20 }],
      });
    return j([
      {
        id: mintA,
        decimals: 8,
        usdPrice: 25,
        stats24h: { priceChange: 2, buyVolume: 100, sellVolume: 50 },
      },
      {
        id: "44444444444444444444444444444444",
        symbol: "SPOOF",
        decimals: 9,
        usdPrice: 100,
      },
    ]);
  };
  const snapshot = await getMainnetMarkets({ fetcher });
  expect(snapshot.assets.length).toBe(3);
  expect(snapshot.assets.find((a) => a.mint === mintA)!.volume24hUsd).toBe(150);
  expect(snapshot.assets.find((a) => a.mint === mintB)!.priceUsd).toBe(null);
  expect(snapshot.assets.find((a) => a.mint === mintB)!.decimals).toBe(null);
  expect(snapshot.assets.find((a) => a.mint === mintB)!.kind).toBe("unknown");
  expect(snapshot.assets.find((a) => a.mint === mintP)!.tradingHalted).toBe(
    true,
  );
  expect(snapshot.assets.find((a) => a.mint === mintP)!.decimals).toBe(9);
  expect(requested.some((url) => url.includes("page=1"))).toBeTruthy();
  expect(snapshot.status).toBe("partial");
});

test("provider outages produce honest unavailable state with no seeded assets or prices", async () => {
  const snapshot = await getMainnetMarkets({
    fetcher: async () => {
      throw new Error("offline");
    },
  });
  expect(snapshot.assets).toEqual([]);
  expect(snapshot.status).toBe("unavailable");
  expect(snapshot.baskets.every((basket) => !basket.available)).toBeTruthy();
});

test("missing basket members do not cause silent weight renormalization", () => {
  const assets = ["NVDA", "MSFT", "GOOGL", "AMZN"].map((underlyingSymbol) =>
    partial({
      underlyingSymbol,
      issuer: "xstocks",
      priceUsd: 100,
      tradingHalted: false,
      verified: true,
    }),
  );
  const basket = resolveMarketBaskets(assets).find(
    (basket) => basket.id === "sol-ai-infra",
  )!;
  expect(basket.available).toBe(false);
  expect(basket.missingSymbols).toEqual(["ORCL"]);
  expect(
    basket.assets.reduce((sum, member) => sum + member.weight, 0) < 10000,
  ).toBeTruthy();
});

test("all complete thematic baskets have exactly 10000 basis points and original, issuer-resolved members", () => {
  const symbols = [
    ...new Set(
      CANONICAL_BASKET_DEFINITIONS.filter(
        (definition) => definition.issuer === "xstocks",
      ).flatMap((definition) => definition.symbols),
    ),
  ];
  const assets = symbols.map((underlyingSymbol) =>
    partial({
      mint: underlyingSymbol,
      underlyingSymbol,
      issuer: "xstocks",
      priceUsd: 100,
      tradingHalted: false,
      verified: true,
    }),
  );
  assets.push(
    partial({
      mint: mintP,
      underlyingSymbol: "PRIVATE",
      issuer: "prestocks",
      priceUsd: 20,
      tradingHalted: false,
      verified: true,
    }),
  );
  const baskets = resolveMarketBaskets(assets);
  expect(baskets.map((basket) => basket.id)).toEqual(
    CANONICAL_BASKET_DEFINITIONS.map((definition) => definition.id),
  );
  for (const basket of baskets) {
    expect(basket.available, basket.id).toBe(true);
    expect(
      basket.assets.reduce((sum, member) => sum + member.weight, 0),
      basket.id,
    ).toBe(10000);
    expect(basket.missingSymbols).toEqual([]);
    expect(basket.unpricedSymbols).toEqual([]);
    expect(
      basket.assets.every((member) => assets.includes(member.asset)),
    ).toBeTruthy();
  }
  assets.find((asset) => asset.underlyingSymbol === "NVDA")!.priceUsd = null;
  const incomplete = resolveMarketBaskets(assets).find(
    (basket) => basket.id === "sol-chips",
  )!;
  expect(incomplete.available).toBe(false);
  expect(incomplete.unpricedSymbols).toEqual(["NVDA"]);
  expect(
    incomplete.assets.reduce((sum, member) => sum + member.weight, 0),
  ).toBe(10000);
});
