/** Off-chain Pyth Hermes client and market-asset price hydration. */

import { Buffer } from "buffer";
import type { MarketAsset } from "../markets";
import { getEquityFeedId, normalizeSymbol, XSTOCKS_PYTH_FEEDS } from "./feeds";
import {
  PythOracleError,
  type PythFeedInfo,
  type PythPriceData,
} from "./types";

/**
 * Hydrates an array of market assets with real-time Pyth reference prices.
 * Fetches feed updates via Hermes in a single batch request, reducing reliance on DEX quotes.
 */
export async function hydratePythPrices(
  assets: MarketAsset[],
  options?: {
    hermesApiKey?: string;
    hermesBaseUrl?: string;
  },
): Promise<{ count: number; source: string }> {
  const targets: { asset: MarketAsset; feedId: string }[] = [];
  for (const asset of assets) {
    const feedId =
      getEquityFeedId(asset.underlyingSymbol) || getEquityFeedId(asset.symbol);
    if (feedId) {
      targets.push({ asset, feedId });
    }
  }
  if (!targets.length) return { count: 0, source: "none" };

  const uniqueFeedIds = [...new Set(targets.map((t) => t.feedId))];
  const client = new PythHermesClient(
    options?.hermesBaseUrl ?? "https://hermes.pyth.network",
    options?.hermesApiKey,
  );

  const prices = await client.getLatestPrices(uniqueFeedIds);
  if (!prices.length) return { count: 0, source: "none" };

  const byFeedId = new Map(prices.map((p) => [p.feedId.toLowerCase(), p]));
  let count = 0;

  for (const { asset, feedId } of targets) {
    const quote = byFeedId.get(feedId.toLowerCase());
    if (quote && quote.price > 0) {
      asset.underlyingPriceUsd = quote.price;
      asset.underlyingPriceUpdatedAt = new Date(
        quote.publishTime * 1000,
      ).toISOString();
      asset.underlyingPriceSource = "pyth";
      asset.underlyingConfidenceUsd = quote.confidence;
      asset.isRealTimePyth = true;
      count++;
    }
  }

  return { count, source: "Pyth Network Oracles" };
}

// ---------------------------------------------------------------------------
// Pyth Hermes REST Client (Metadata & Search)
// ---------------------------------------------------------------------------

export class PythHermesClient {
  public readonly baseUrl: string;
  public readonly apiKey?: string;

  constructor(
    baseUrl: string = "https://hermes.pyth.network",
    apiKey?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey =
      apiKey ||
      (typeof process !== "undefined"
        ? process.env?.PYTH_API_KEY ||
          process.env?.HERMES_API_KEY ||
          process.env?.NEXT_PUBLIC_PYTH_API_KEY
        : undefined);
  }

  /**
   * Search for Pyth price feeds by symbol or query string.
   */
  async searchFeeds(
    query: string,
    assetType?: string,
  ): Promise<PythFeedInfo[]> {
    try {
      const url = new URL(`${this.baseUrl}/v2/price_feeds`);
      url.searchParams.append("query", query);
      if (assetType) {
        url.searchParams.append("asset_type", assetType);
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new PythOracleError(
          `Hermes API search error: ${res.status} ${res.statusText}`,
        );
      }

      const payload: unknown = await res.json();
      if (!Array.isArray(payload))
        throw new PythOracleError("Hermes returned invalid feed metadata.");
      return payload.filter((feed): feed is PythFeedInfo =>
        Boolean(
          feed &&
          typeof feed === "object" &&
          typeof feed.id === "string" &&
          /^(0x)?[a-fA-F0-9]{64}$/.test(feed.id) &&
          feed.attributes &&
          typeof feed.attributes === "object" &&
          typeof feed.attributes.symbol === "string",
        ),
      );
    } catch (err) {
      if (err instanceof PythOracleError) throw err;
      throw new PythOracleError("Failed to search Pyth feeds.");
    }
  }

  /**
   * Fetch latest price updates from Hermes for given feed IDs.
   */
  async getLatestPrices(feedIds: string[]): Promise<PythPriceData[]> {
    if (!feedIds.length) return [];
    try {
      const url = new URL(`${this.baseUrl}/v2/updates/price/latest`);
      for (const id of feedIds) {
        const clean = id.startsWith("0x") ? id : `0x${id}`;
        url.searchParams.append("ids[]", clean);
      }
      url.searchParams.set("parsed", "true");
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const payload: unknown = await res.json();
      if (
        !payload ||
        typeof payload !== "object" ||
        !Array.isArray((payload as { parsed?: unknown }).parsed)
      ) {
        return [];
      }
      const results: PythPriceData[] = [];
      for (const item of (payload as { parsed: unknown[] }).parsed) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        if (
          typeof row.id !== "string" ||
          !row.price ||
          typeof row.price !== "object"
        )
          continue;
        const raw = row.price as Record<string, unknown>;
        const rawPrice = String(raw.price);
        const expo = Number(raw.expo);
        const publishTime = Number(raw.publish_time);
        const price = Number(rawPrice) * Math.pow(10, expo);
        const conf = Number(raw.conf) * Math.pow(10, expo);
        if (Number.isFinite(price) && price > 0) {
          results.push({
            feedId: row.id.startsWith("0x") ? row.id : `0x${row.id}`,
            price,
            confidence: conf,
            expo,
            rawPrice,
            rawConfidence: String(raw.conf),
            publishTime,
            status: "trading",
          });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Look up Pyth feed details for an xStock symbol.
   */
  async getFeedDetails(symbol: string): Promise<PythFeedInfo | null> {
    const norm = normalizeSymbol(symbol);
    const feeds = await this.searchFeeds(`${norm}X`);
    return (
      feeds.find((feed) => feed.attributes?.symbol === `Crypto.${norm}X/USD`) ??
      null
    );
  }
}
