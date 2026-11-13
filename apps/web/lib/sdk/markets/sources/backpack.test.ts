import { expect, test } from "vitest";
import type { BackpackSecurity } from "./backpack";
import { parseBackpackSecurities, getBackpackCatalog } from "./backpack";
import { getMainnetCatalog, getMainnetMarkets } from "../index";
import { hasCompleteIssuerCatalogs } from "../../trade";
const mint = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";
const session = {
  name: "US_EQUITIES_REGULAR",
  minQuantity: "0.01",
  maxQuantity: "10000",
  stepSize: "0.00001",
};
const security = {
  asset: "SPCX.US",
  name: "SpaceX",
  cusip: "000000000",
  sessions: [session],
};
const mapping = {
  symbol: "SPCX.US",
  tokens: [
    {
      blockchain: "Solana",
      contractAddress: mint,
      nativeDecimals: 6,
      depositEnabled: true,
      withdrawEnabled: true,
    },
  ],
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

test("discovery IDs never become fake mints or pretend prices", () => {
  const [result] = parseBackpackSecurities([security]) as [BackpackSecurity];
  expect(result.id).toBe("backpack:SPCX.US");
  expect(result.solanaMint).toBe(null);
  expect(result.discoveryOnly).toBe(true);
  expect("mint" in result).toBe(false);
  expect("priceUsd" in result).toBe(false);
  expect(result.underlyingSymbol).toBe("SPCX");
});

test("only an unambiguous official Solana mapping with enabled transfers is eligible", () => {
  const parse = (assets?: Parameters<typeof parseBackpackSecurities>[1]) =>
    parseBackpackSecurities([security], assets)[0];
  expect(parse([mapping]).discoveryOnly).toBe(false);
  expect(parse([mapping]).solanaMint).toBe(mint);
  for (const token of [
    { ...mapping.tokens[0], blockchain: "Ethereum" },
    { ...mapping.tokens[0], contractAddress: "backpack:SPCX.US" },
    { ...mapping.tokens[0], withdrawEnabled: false },
    { ...mapping.tokens[0], nativeDecimals: null },
  ])
    expect(parse([{ ...mapping, tokens: [token] }]).discoveryOnly).toBe(true);
  const conflict = {
    ...mapping,
    tokens: [
      {
        ...mapping.tokens[0],
        contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      },
    ],
  };
  expect(parse([mapping, conflict]).solanaMint).toBe(null);
  expect(parse([mapping, conflict]).candidateSolanaMints).toEqual([
    mint,
    conflict.tokens[0].contractAddress,
  ]);
  expect(
    parse([
      mapping,
      { ...mapping, tokens: [{ ...mapping.tokens[0], depositEnabled: false }] },
    ]).discoveryOnly,
  ).toBe(true);
});

test("exchange perpetuals, hidden books and RFQ symbols are not called spot availability", () => {
  const market = {
    baseSymbol: "SPCX.US",
    rwaMarketType: "STOCK",
    marketType: "SPOT",
    visible: true,
    symbol: "SPCX.US_USDC",
    orderBookState: "Open",
  };
  const [result] = parseBackpackSecurities(
    [security],
    [mapping],
    [
      market,
      { ...market, marketType: "PERP" },
      { ...market, visible: false },
      { ...market, marketType: "RFQ" },
    ],
  );
  expect(result.spotMarkets).toEqual([
    { symbol: "SPCX.US_USDC", state: "Open" },
  ]);
});

test("mapping outage preserves real discovery without enabling token orders", async () => {
  const result = await getBackpackCatalog({
    fetcher: async (url) =>
      String(url).endsWith("/securities")
        ? json([security])
        : new Response("", { status: 503 }),
  });
  expect(result.securities.length).toBe(1);
  expect(result.securities[0].discoveryOnly).toBe(true);
  expect(result.warnings.length).toBe(2);
  await await expect(
    getBackpackCatalog({ fetcher: async () => json({ results: [security] }) }),
  ).rejects.toThrow(/catalog could not be loaded/);
});

test("malformed mapping rows and mixed invalid securities cannot claim complete issuer verification", async () => {
  const result = await getBackpackCatalog({
    fetcher: async (url) => {
      if (String(url).endsWith("/securities")) return json([security]);
      if (String(url).endsWith("/assets"))
        return json([{ unexpectedSchema: true }]);
      return json([]);
    },
  });
  expect(result.mappingsAvailable).toBe(false);
  expect(result.securities[0].discoveryOnly).toBe(true);
  expect(
    result.warnings.some((warning) =>
      warning.includes("mappings could not be verified"),
    ),
  ).toBeTruthy();
  expect(() =>
    parseBackpackSecurities(
      [security, { ...security, asset: "AAPL.US", sessions: null }],
      [mapping],
    ),
  ).toThrow(/invalid listing/);
  expect(() =>
    parseBackpackSecurities([security, security], [mapping]),
  ).toThrow(/duplicate listing/);
});

test("new-format snapshots require Backpack mappings before unknown-token trade fallback", () => {
  const snapshot: Parameters<typeof hasCompleteIssuerCatalogs>[0] & {
    sources: string[];
    backpackSecurities?: BackpackSecurity[];
  } = {
    status: "live",
    sources: ["xStocks issuer catalog", "PreStocks issuer catalog"],
  };
  expect(
    hasCompleteIssuerCatalogs(snapshot),
    "old persisted snapshots remain readable",
  ).toBe(true);
  snapshot.backpackSecurities = [];
  expect(hasCompleteIssuerCatalogs(snapshot)).toBe(false);
  snapshot.sources.push("Backpack securities catalog");
  expect(hasCompleteIssuerCatalogs(snapshot)).toBe(false);
  snapshot.sources.push("Backpack Solana mappings");
  expect(hasCompleteIssuerCatalogs(snapshot)).toBe(true);
});

test("only transfer-enabled tokens enter issuer pricing and catalog snapshots retain separate discovery", async () => {
  const requests: string[] = [];
  const fetcher = async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("xstocks.fi"))
      return json({ nodes: [], page: { hasNextPage: false } });
    if (url.endsWith("/products")) return new Response("");
    if (url.endsWith("/api/metrics")) return json({ metrics: [] });
    if (url.endsWith("/securities"))
      return json([security, { ...security, asset: "AAPL.US", name: "Apple" }]);
    if (url.endsWith("/assets")) return json([mapping]);
    if (url.endsWith("/markets")) return json([]);
    if (url.includes("/tokens/v2/"))
      return json([{ id: mint, usdPrice: 99, decimals: 6 }]);
    return json({});
  };
  const catalog = await getMainnetCatalog({ fetcher });
  expect(catalog.backpackSecurities!.length).toBe(2);
  expect(catalog.assets.length).toBe(1);
  expect(catalog.assets[0].issuer).toBe("backpack");
  expect(
    catalog.assets[0].kind,
    "security catalog does not classify equities versus ETFs",
  ).toBe("unknown");
  const result = await getMainnetMarkets({ catalog, fetcher });
  expect(result.assets[0].priceUsd).toBe(99);
  expect(result.backpackSecurities!.length).toBe(2);
  expect(
    requests
      .filter((url) => url.includes("jup.ag"))
      .every((url) => !url.includes("backpack:") && !url.includes("AAPL.US")),
  ).toBeTruthy();
});
