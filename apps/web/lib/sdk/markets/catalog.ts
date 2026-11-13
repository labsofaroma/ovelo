import { BACKPACK_ASSETS_URL, getBackpackCatalog } from "../backpack";
import { hydratePythPrices } from "../pyth";
import { resolveMarketBaskets } from "./baskets";
import { request, resolveJupiterApiKey } from "./http";
import { row } from "./parse";
import { jupiterPriceSchema, jupiterTokenSchema, precision } from "./schemas";
import { baseAsset } from "./sources/base";
import { prestockCatalog } from "./sources/prestocks";
import { xstockCatalog } from "./sources/xstocks";
import {
  ISSUER_CATALOG_VERSION,
  type MarketAsset,
  type MarketOptions,
  type MarketSnapshot,
} from "./types";

/** Issuer identity does not depend on Jupiter prices or token metadata. */
export async function getMainnetCatalog(
  options: MarketOptions = {},
): Promise<MarketSnapshot> {
  const withDeadline = (milliseconds: number): MarketOptions => {
    const deadline = AbortSignal.timeout(milliseconds);
    return {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline,
    };
  };
  // xStocks requires several paginated batches. An eight-second total deadline
  // could discard a healthy catalog while its final response bodies arrived.
  // Other issuer metadata keeps its shorter budget; caller cancellation wins.
  const paginatedOptions = withDeadline(options.fetcher ? 20_000 : 35_000);
  const metadataOptions = withDeadline(8_000);
  const warnings: string[] = [];
  const sources: string[] = [];
  const [catalogs, backpack] = await Promise.all([
    Promise.allSettled([
      xstockCatalog(paginatedOptions),
      prestockCatalog(metadataOptions),
    ]),
    getBackpackCatalog(metadataOptions).then(
      (value) => ({ status: "fulfilled" as const, value }),
      () => ({ status: "rejected" as const }),
    ),
  ]);
  const byMint = new Map<string, MarketAsset>();
  catalogs.forEach((result, index) => {
    if (result.status === "fulfilled") {
      result.value.forEach((asset) => byMint.set(asset.mint, asset));
      sources.push(
        index === 0 ? "xStocks issuer catalog" : "PreStocks issuer catalog",
      );
    } else
      warnings.push(
        `${index === 0 ? "xStocks" : "PreStocks"} catalog could not be loaded. Retry to discover its assets.`,
      );
  });
  if (backpack.status === "fulfilled") {
    sources.push("Backpack securities catalog");
    if (backpack.value.mappingsAvailable)
      sources.push("Backpack Solana mappings");
    warnings.push(...backpack.value.warnings);
    for (const security of backpack.value.securities) {
      if (
        security.discoveryOnly ||
        !security.solanaMint ||
        byMint.has(security.solanaMint)
      )
        continue;
      const asset = baseAsset(
        security.solanaMint,
        security.symbol,
        security.name,
        "backpack",
        BACKPACK_ASSETS_URL,
      );
      asset.underlyingSymbol = security.underlyingSymbol;
      asset.decimals = security.decimals;
      // /securities does not publish a reliable equity/ETF classification.
      // The mint's program, extensions and precision are checked again before trading.
      byMint.set(asset.mint, asset);
    }
  } else
    warnings.push(
      "Backpack securities catalog could not be loaded. Retry to discover its listings.",
    );
  const assets = [...byMint.values()];
  return {
    assets,
    backpackSecurities:
      backpack.status === "fulfilled" ? backpack.value.securities : [],
    backpackObservedAt:
      backpack.status === "fulfilled" ? backpack.value.observedAt : undefined,
    baskets: resolveMarketBaskets(assets, { includeAll: true }),
    asOf: new Date().toISOString(),
    network: "mainnet-beta",
    issuerCatalogVersion: ISSUER_CATALOG_VERSION,
    sources,
    status:
      assets.length === 0 &&
      !(backpack.status === "fulfilled" && backpack.value.securities.length)
        ? "unavailable"
        : warnings.length
          ? "partial"
          : "live",
    warnings,
  };
}

/** Prices and metadata are requested only for mints obtained from the issuers themselves. */
export async function getMainnetMarkets(
  options: MarketOptions = {},
): Promise<MarketSnapshot> {
  const deadline = AbortSignal.timeout(30_000);
  options = {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline,
  };
  const catalog = options.catalog ?? (await getMainnetCatalog(options));
  const warnings = [...catalog.warnings];
  const sources = [...catalog.sources];
  const byMint = new Map(
    catalog.assets.map((asset) => [asset.mint, { ...asset }]),
  );
  const mints = [...byMint.keys()];
  const base =
    options.jupiterBaseUrl ??
    (resolveJupiterApiKey(options.jupiterApiKey)
      ? "https://api.jup.ag"
      : "https://lite-api.jup.ag");
  if (!/^https:\/\/(api|lite-api)\.jup\.ag$/.test(base))
    throw new Error("Unsupported Jupiter API origin");
  const batches: string[][] = [];
  for (let index = 0; index < mints.length; index += 100)
    batches.push(mints.slice(index, index + 100));
  // Bound concurrency to three rather than serializing hundreds of mints or flooding the provider.
  const hydrateBatch = async (batch: string[]): Promise<void> => {
    try {
      const payload = await request(
        `${base}/tokens/v2/search?query=${batch.join(",")}`,
        options,
      );
      if (!Array.isArray(payload))
        throw new Error("Jupiter token data is unavailable");
      const observedAt = new Date().toISOString();
      for (const item of payload) {
        const token = jupiterTokenSchema.parse(item);
        const asset = byMint.get(token.id);
        if (!asset) continue;
        asset.decimals = precision(token.decimals) ?? asset.decimals;
        asset.name = token.name || asset.name;
        asset.logoUrl = token.icon ?? asset.logoUrl;
        if (token.usdPrice !== null) {
          asset.priceUsd = token.usdPrice;
          asset.priceObservedAt = observedAt;
          asset.priceSource = "jupiter-tokens-v2";
          asset.priceBlockId = token.priceBlockId;
        }
        const stats = token.stats24h;
        asset.change24hPct = stats.priceChange;
        asset.volume24hUsd =
          stats.buyVolume !== null && stats.sellVolume !== null
            ? stats.buyVolume + stats.sellVolume
            : null;
        asset.liquidityUsd = token.liquidity;
        asset.marketCapUsd = token.mcap ?? asset.marketCapUsd;
        asset.updatedAt = token.updatedAt;
      }
      if (!sources.includes("Jupiter Tokens V2"))
        sources.push("Jupiter Tokens V2");
    } catch {
      warnings.push(
        "Some Jupiter prices and token metadata are unavailable. Unpriced assets cannot be traded in paper mode.",
      );
    }
  };
  for (let index = 0; index < batches.length; index += 3)
    await Promise.all(batches.slice(index, index + 3).map(hydrateBatch));
  options.onUpdate?.(snapshot());

  const pythKey =
    options.pythApiKey ||
    (typeof process !== "undefined"
      ? process.env?.PYTH_API_KEY || process.env?.HERMES_API_KEY
      : undefined);
  if (options.includePriceReferences !== false && pythKey) {
    try {
      const pythResult = await hydratePythPrices([...byMint.values()], {
        hermesApiKey: pythKey,
        hermesBaseUrl: options.pythBaseUrl,
      });
      if (pythResult.count > 0 && !sources.includes("Pyth Network Oracles")) {
        sources.push("Pyth Network Oracles");
      }
    } catch {
      // Graceful fallback to Jupiter Price V3 stockData below
    }
  }

  const fallbackMints = new Set(options.priceFallbackMints ?? []);
  const priceMints =
    options.includePriceReferences === false
      ? mints.filter(
          (mint) =>
            fallbackMints.has(mint) &&
            byMint.get(mint)?.priceSource !== "jupiter-tokens-v2",
        )
      : mints;
  if (!priceMints.length) return snapshot();
  // Price V3 also supplies issuer-backed underlying reference quotes for xStocks
  // with no recent onchain swap. Never turn those references into token fills.
  const priceBatches: string[][] = [];
  for (let index = 0; index < priceMints.length; index += 50)
    priceBatches.push(priceMints.slice(index, index + 50));
  const hydratePrices = async (batch: string[]): Promise<void> => {
    try {
      const payload = await request(
        `${base}/price/v3?ids=${batch.join(",")}`,
        options,
      );
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error("Jupiter price data is unavailable");
      const prices = row(payload);
      const observedAt = new Date().toISOString();
      for (const mint of batch) {
        const asset = byMint.get(mint);
        if (!asset) continue;
        const value = jupiterPriceSchema.parse(prices[mint]);
        asset.decimals = precision(value.decimals) ?? asset.decimals;
        if (value.usdPrice !== null) {
          asset.priceUsd = value.usdPrice;
          asset.priceObservedAt = observedAt;
          asset.priceSource = "jupiter-price-v3";
          asset.priceBlockId = value.blockId;
          asset.change24hPct = value.priceChange24h ?? asset.change24hPct;
          asset.liquidityUsd = value.liquidity ?? asset.liquidityUsd;
        }
        const stock = value.stockData;
        if (
          asset.issuer === "xstocks" &&
          stock.id === "xstocks" &&
          asset.underlyingPriceSource !== "pyth"
        ) {
          asset.underlyingPriceUsd = stock.price;
          asset.underlyingPriceUpdatedAt = stock.updatedAt;
          asset.underlyingMarketCapUsd = stock.mcap;
          asset.underlyingPriceSource = "jupiter-stock-data";
        }
      }
      if (!sources.includes("Jupiter Price V3"))
        sources.push("Jupiter Price V3");
    } catch {
      warnings.push(
        "Some Jupiter price and underlying reference quotes are unavailable. Available token metadata is retained.",
      );
    }
  };
  for (let index = 0; index < priceBatches.length; index += 3)
    await Promise.all(priceBatches.slice(index, index + 3).map(hydratePrices));
  return snapshot();

  function snapshot(): MarketSnapshot {
    // Detach progressive responses from the objects still being enriched.
    const assets = [...byMint.values()]
      .map((asset) => ({ ...asset }))
      .sort(
        (a, b) =>
          (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) ||
          a.symbol.localeCompare(b.symbol),
      );
    const snapshotWarnings = [...warnings];
    const unpriced = assets.filter((asset) => asset.priceUsd === null).length;
    if (unpriced > 0)
      snapshotWarnings.push(
        `${unpriced} issuer-listed assets have no observed token market price. Underlying reference quotes are shown separately where available and cannot fund paper trades.`,
      );
    if (assets.some((asset) => asset.tradingHalted))
      snapshotWarnings.push(
        "Paused, converted, or unverified-status issuer products are listed for reference with trading disabled.",
      );
    return {
      assets,
      backpackSecurities: catalog.backpackSecurities,
      backpackObservedAt: catalog.backpackObservedAt,
      baskets: resolveMarketBaskets(assets, { includeAll: true }),
      asOf: new Date().toISOString(),
      network: "mainnet-beta",
      issuerCatalogVersion: catalog.issuerCatalogVersion,
      sources: [...sources],
      status:
        assets.length === 0 && !catalog.backpackSecurities?.length
          ? "unavailable"
          : snapshotWarnings.length
            ? "partial"
            : "live",
      warnings: [...new Set(snapshotWarnings)],
    };
  }
}
