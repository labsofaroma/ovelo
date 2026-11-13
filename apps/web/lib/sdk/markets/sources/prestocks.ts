import { CATALOG_TTL_MS, request, requestSignal } from "../http";
import { logo, number, row, string, validMint, type Row } from "../parse";
import type { MarketAsset, MarketOptions } from "../types";
import { prestocksMetricSchema } from "../schemas";
import { baseAsset } from "./base";

let prestockProductsCache: { products: Row[]; expiresAt: number } | null = null;

async function getPrestockProducts(options: MarketOptions): Promise<Row[]> {
  if (
    !options.fetcher &&
    prestockProductsCache &&
    prestockProductsCache.expiresAt > Date.now()
  )
    return prestockProductsCache.products;
  const response = await (options.fetcher ?? fetch)(
    "https://prestocks.com/products",
    { signal: requestSignal(options), cache: "no-store" },
  );
  if (!response.ok)
    throw new Error("PreStocks product metadata is unavailable");
  const products = parsePrestockProducts(await response.text());
  if (!products.length)
    throw new Error("PreStocks product metadata could not be verified");
  if (!options.fetcher)
    prestockProductsCache = {
      products,
      expiresAt: Date.now() + CATALOG_TTL_MS,
    };
  return products;
}

export async function prestockCatalog(
  options: MarketOptions,
): Promise<MarketAsset[]> {
  const [metricsResult, productsResult] = await Promise.allSettled([
    request("https://prestocks.com/api/metrics", options).then((value) => ({
      value,
      observedAt: new Date().toISOString(),
    })),
    getPrestockProducts(options),
  ]);
  if (metricsResult.status === "rejected")
    throw new Error("PreStocks metrics are unavailable");
  const response = row(metricsResult.value.value);
  const observedAt = metricsResult.value.observedAt;
  const products =
    productsResult.status === "fulfilled" ? productsResult.value : [];
  const metadata = new Map(
    products.map((value) => [string(value.splMint), value]),
  );
  if (!Array.isArray(response.metrics))
    throw new Error("PreStocks catalog response is unavailable");
  return response.metrics.flatMap((item) => {
    const value = prestocksMetricSchema.parse(item);
    const mint = value.splMint;
    const symbol = value.symbol;
    if (!validMint(mint) || !symbol) return [];
    const asset = baseAsset(
      mint,
      symbol,
      symbol,
      "prestocks",
      "https://prestocks.com/products",
    );
    const product = metadata.get(mint);
    if (product) {
      asset.name = string(product.name) || symbol;
      const decimals = number(product.decimals);
      asset.decimals =
        decimals !== null &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= 18
          ? decimals
          : null;
      const productLogo = string(product.productLogo);
      asset.logoUrl = productLogo.startsWith("/ui/")
        ? `https://prestocks.com${productLogo}`
        : logo(productLogo);
    }
    // The issuer retains metrics for converted/withdrawn products. Those are visible, but not new trade targets.
    asset.tradingHalted =
      !product ||
      product.skipPipeline === true ||
      product.hideOnPrestocksApi === true;
    if (asset.tradingHalted)
      asset.tradingNotice = product
        ? "The issuer has paused or withdrawn this product. Check its product page for conversion terms."
        : "Issuer trading status is unavailable. Trading is disabled until it can be verified.";
    asset.priceUsd = value.tokenPrice;
    asset.priceSource = asset.priceUsd === null ? null : "prestocks-issuer";
    asset.marketCapUsd = value.marketCapUSD;
    asset.priceObservedAt = asset.priceUsd === null ? null : observedAt;
    return [asset];
  });
}

/** Read public server-rendered product JSON; never execute the issuer's JavaScript. */
function parsePrestockProducts(html: string): Row[] {
  const chunks: string[] = [];
  const scriptPattern =
    /<script\b[^>]*>self\.__next_f\.push\((.*?)\)<\/script>/gs;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (Array.isArray(value) && typeof value[1] === "string")
        chunks.push(value[1]);
    } catch {
      /* Ignore non-JSON script tags. */
    }
  }
  const products: Row[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = row(value);
    if (Array.isArray(object.products))
      products.push(...object.products.map(row));
    else Object.values(object).forEach(walk);
  };
  for (const line of chunks.join("").split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0 || !line.includes('"products":')) continue;
    try {
      walk(JSON.parse(line.slice(separator + 1)));
    } catch {
      /* Schema drift fails closed for new trading. */
    }
  }
  return products;
}
