import type { MarketAsset, MarketBasket } from "../../markets";
import {
  MAX_CUSTOM_BASKET_LEGS,
  MIN_CUSTOM_BASKET_LEGS,
  type BasketAllocation,
  type ProgrammableBasket,
} from "./types";

/** Resolves a ProgrammableBasket into an executable MarketBasket against the live catalog. */
export function resolveProgrammableBasket(
  basket: ProgrammableBasket,
  assets: MarketAsset[],
): MarketBasket {
  const byMint = new Map(assets.map((a) => [a.mint, a]));
  const missingSymbols: string[] = [];
  const unpricedSymbols: string[] = [];
  const resolvedMembers: Array<{ asset: MarketAsset; weight: number }> = [];

  for (const alloc of basket.allocations) {
    const asset = byMint.get(alloc.mint);
    if (!asset) {
      missingSymbols.push(alloc.symbol);
    } else {
      if (
        asset.priceUsd === null ||
        !Number.isFinite(asset.priceUsd) ||
        asset.priceUsd <= 0
      ) {
        unpricedSymbols.push(asset.symbol);
      }
      resolvedMembers.push({ asset, weight: alloc.weightBps });
    }
  }

  const available =
    missingSymbols.length === 0 &&
    unpricedSymbols.length === 0 &&
    resolvedMembers.length >= MIN_CUSTOM_BASKET_LEGS &&
    resolvedMembers.every(
      ({ asset }) => asset.verified && !asset.tradingHalted,
    );

  return {
    id: basket.id,
    name: basket.name,
    ticker: basket.ticker,
    category: basket.category,
    description: basket.description,
    assets: resolvedMembers,
    missingSymbols,
    unpricedSymbols,
    available,
    isCustom: true,
    creatorName: basket.creatorName,
    creatorSocial: basket.creatorSocial,
  };
}
