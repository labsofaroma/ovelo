import { CATALOG_TTL_MS, request } from "../http";
import { list, row, validMint, type Row } from "../parse";
import { xstocksNodeSchema } from "../schemas";
import type { MarketAsset, MarketOptions } from "../types";
import { baseAsset } from "./base";

let xstocksCache: { assets: MarketAsset[]; expiresAt: number } | null = null;
let xstocksPending: Promise<MarketAsset[]> | null = null;

export async function xstockCatalog(
  options: MarketOptions,
): Promise<MarketAsset[]> {
  if (!options.fetcher && xstocksCache && xstocksCache.expiresAt > Date.now())
    return xstocksCache.assets.map((asset) => ({ ...asset }));
  if (!options.fetcher && xstocksPending)
    return (await xstocksPending).map((asset) => ({ ...asset }));
  const operation = loadXstockCatalog(options);
  if (!options.fetcher) xstocksPending = operation;
  try {
    const assets = await operation;
    if (!options.fetcher)
      xstocksCache = { assets, expiresAt: Date.now() + CATALOG_TTL_MS };
    return assets.map((asset) => ({ ...asset }));
  } finally {
    if (!options.fetcher) xstocksPending = null;
  }
}

async function loadXstockCatalog(
  options: MarketOptions,
): Promise<MarketAsset[]> {
  const assets = new Map<string, MarketAsset>();
  const pageRequest = async (page: number): Promise<Row> => {
    const url = `https://api.xstocks.fi/api/v2/public/assets?network=Solana&page=${page}&pageSize=100`;
    const response = row(await request(url, options));
    if (!Array.isArray(response.nodes))
      throw new Error("xStocks catalog response is unavailable");
    return response;
  };

  const processPageNodes = (nodes: unknown[]): void => {
    for (const item of nodes) {
      const node = xstocksNodeSchema.parse(item);
      for (const token of node.deployments) {
        if (
          token.network !== "Solana" ||
          !validMint(token.address) ||
          !node.symbol
        )
          continue;
        const asset = baseAsset(
          token.address,
          node.symbol,
          node.name,
          "xstocks",
          "https://api.xstocks.fi/api/v2/public/assets",
        );
        asset.logoUrl = node.logo;
        asset.underlyingSymbol =
          node.underlying.symbol ||
          node.underlyingSymbol ||
          asset.symbol.replace(/x$/, "");
        asset.kind =
          node.underlying.type === "ETF"
            ? "etf"
            : node.underlying.type === "Equity"
              ? "equity"
              : "unknown";
        asset.tradingHalted = node.isTradingHalted;
        assets.set(token.address, asset);
      }
    }
  };

  const batchSize = options.fetcher ? 1 : 3;
  let complete = false;
  for (let page = 0; page < 50; page += batchSize) {
    const pages = Array.from(
      { length: Math.min(batchSize, 50 - page) },
      (_, index) => page + index,
    );
    const results = await Promise.allSettled(pages.map(pageRequest));
    for (const result of results) {
      // A failed required page is not the end of the issuer catalog. Never
      // cache the discovered prefix as a complete set of issuer identities.
      if (result.status === "rejected") throw result.reason;
      const response = result.value;
      const hasNextPage = row(response.page).hasNextPage;
      if (
        typeof hasNextPage !== "boolean" ||
        (hasNextPage && list(response.nodes).length === 0)
      )
        throw new Error("xStocks catalog pagination could not be verified");
      processPageNodes(list(response.nodes));
      if (!hasNextPage) {
        complete = true;
        break;
      }
    }
    if (complete) break;
  }
  if (!complete)
    throw new Error("xStocks catalog exceeded the pagination limit");

  if (assets.size === 0) {
    throw new Error("xStocks catalog returned no valid assets");
  }

  return [...assets.values()];
}
