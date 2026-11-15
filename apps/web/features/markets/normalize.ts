import type {
  MarketAsset,
  MarketBasket,
  MarketSnapshot,
} from "@/lib/sdk/markets";
import { getMarketPulse } from "@/lib/sdk/research/pulse";
import { fixedFromNumber } from "../shared/fixed";
import {
  DECIMALS,
  marketsViewSchema,
  type BasketSummary,
  type MarketRow,
  type MarketsView,
  type Pulse,
} from "./schema";

const price = (value: number | null | undefined) =>
  value != null && value > 0 ? fixedFromNumber(value, DECIMALS.price) : null;
const usd = (value: number | null | undefined) =>
  value != null && value >= 0 ? fixedFromNumber(value, DECIMALS.usd) : null;
const pct = (value: number | null | undefined) =>
  fixedFromNumber(value, DECIMALS.percent);

export function toMarketRow(asset: MarketAsset): MarketRow {
  const tokenPrice = price(asset.priceUsd);
  const referencePrice = price(asset.underlyingPriceUsd);
  return {
    mint: asset.mint,
    symbol: asset.symbol,
    name: asset.name,
    underlyingSymbol: asset.underlyingSymbol,
    issuer: asset.issuer,
    kind: asset.kind,
    logoUrl: asset.logoUrl,
    verified: asset.verified,
    tradingHalted: asset.tradingHalted,
    tradingNotice: asset.tradingNotice ?? null,
    sourceUrl: asset.sourceUrl,
    price: tokenPrice,
    // A price without an observation time cannot be shown (PRODUCT.md), so both go together.
    priceObservedAt: tokenPrice ? asset.priceObservedAt : null,
    priceSource: tokenPrice ? (asset.priceSource ?? null) : null,
    change24h: pct(asset.change24hPct),
    volume24h: usd(asset.volume24hUsd),
    liquidity: usd(asset.liquidityUsd),
    marketCap: usd(asset.marketCapUsd),
    reference:
      referencePrice && asset.underlyingPriceSource
        ? {
            price: referencePrice,
            observedAt: asset.underlyingPriceUpdatedAt ?? null,
            source: asset.underlyingPriceSource,
          }
        : null,
  };
}

export function toBasketSummary(basket: MarketBasket): BasketSummary {
  return {
    id: basket.id,
    name: basket.name,
    ticker: basket.ticker,
    description: basket.description,
    category: basket.category ?? null,
    available: basket.available,
    missingSymbols: basket.missingSymbols,
    unpricedSymbols: basket.unpricedSymbols ?? [],
    members: basket.assets.map(({ asset, weight }) => ({
      mint: asset.mint,
      symbol: asset.symbol,
      weightBps: weight,
    })),
  };
}

/** Movers per ranking on the Markets pulse cards. */
const MOVER_COUNT = 6;

function toPulse(assets: MarketAsset[]): Pulse {
  const pulse = getMarketPulse(assets, MOVER_COUNT);
  const mover = (asset: MarketAsset) => ({
    symbol: asset.symbol,
    name: asset.name,
    change24h: pct(asset.change24hPct),
    volume24h: usd(asset.volume24hUsd),
  });
  return {
    totalAssets: pulse.totalAssets,
    tradableAssets: pulse.tradableAssets,
    pricedAssets: pulse.pricedAssets,
    advancing: pulse.breadth.advancing,
    declining: pulse.breadth.declining,
    unchanged: pulse.breadth.unchanged,
    coveredAssets: pulse.breadth.coveredAssets,
    volume24h: usd(pulse.volume24hUsd),
    volumeCoveredAssets: pulse.volumeCoveredAssets,
    topVolume: pulse.topVolume.map(mover),
    gainers: pulse.gainers.map(mover),
    losers: pulse.losers.map(mover),
  };
}

/**
 * MarketSnapshot (lib/sdk) → MarketsView. Throws when the snapshot has no usable data, so the
 * data cache never stores an outage over the last good snapshot (callers map the error).
 */
export function toMarketsView(snapshot: MarketSnapshot): MarketsView {
  if (snapshot.status === "unavailable" || snapshot.assets.length === 0)
    throw new Error("market snapshot unavailable");
  return marketsViewSchema.parse({
    asOf: snapshot.asOf,
    status: snapshot.status,
    sources: snapshot.sources,
    warnings: snapshot.warnings,
    rows: snapshot.assets.map(toMarketRow),
    baskets: snapshot.baskets.map(toBasketSummary),
    pulse: toPulse(snapshot.assets),
  });
}
