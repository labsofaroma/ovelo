import type { MarketAsset } from "../../markets";
import {
  MAX_CUSTOM_BASKET_LEGS,
  MIN_CUSTOM_BASKET_LEGS,
  type BasketAllocation,
} from "./types";

/** Calculate equal-weight basis points conserving every indivisible unit via Hare-Niemeyer. */
export function calculateEqualWeights(
  assets: Array<{ mint: string; symbol: string; name?: string }>,
): BasketAllocation[] {
  if (!assets.length || assets.length > MAX_CUSTOM_BASKET_LEGS) {
    throw new Error(`Select between 1 and ${MAX_CUSTOM_BASKET_LEGS} assets.`);
  }
  const count = assets.length;
  const base = Math.floor(10_000 / count);
  const remainder = 10_000 % count;
  return assets.map((a, i) => ({
    mint: a.mint,
    symbol: a.symbol,
    name: a.name,
    weightBps: base + (i < remainder ? 1 : 0),
  }));
}

/** Auto-balances basket allocations to sum to exactly 10,000 basis points (100.00%) using the Hare-Niemeyer (Largest Remainder) algorithm in BigInt arithmetic. */
export function autoBalanceWeights(
  allocations: BasketAllocation[],
): BasketAllocation[] {
  if (!allocations.length) return [];
  if (allocations.length > MAX_CUSTOM_BASKET_LEGS) {
    throw new Error(`Select between 1 and ${MAX_CUSTOM_BASKET_LEGS} assets.`);
  }

  const rawWeights = allocations.map((a) => {
    const bps = Number.isFinite(a.weightBps)
      ? Math.max(0, Math.round(a.weightBps))
      : 0;
    return BigInt(bps);
  });

  const totalRaw = rawWeights.reduce((sum, w) => sum + w, 0n);

  // If all weights are 0, distribute equally via Hare-Niemeyer
  if (totalRaw === 0n) {
    return calculateEqualWeights(allocations);
  }

  // If total is under 10,000 and some assets are 0 bps, distribute remainder among those zero-weight assets
  const zeroIndices = rawWeights
    .map((w, i) => (w === 0n ? i : -1))
    .filter((i) => i !== -1);

  if (totalRaw < 10_000n && zeroIndices.length > 0) {
    const remainderToDistribute = 10_000n - totalRaw;
    const count = BigInt(zeroIndices.length);
    const baseShare = remainderToDistribute / count;
    const rem = Number(remainderToDistribute % count);

    const result = allocations.map((a, i) => ({
      ...a,
      weightBps: Number(rawWeights[i]),
    }));

    zeroIndices.forEach((idx, i) => {
      result[idx]!.weightBps = Number(baseShare + (i < rem ? 1n : 0n));
    });

    return result;
  }

  // Proportional scaling via Largest Remainder (Hare-Niemeyer)
  // Ensure every asset has at least 1 unit effective weight so no leg receives 0
  const effectiveWeights = rawWeights.map((w) => (w <= 0n ? 1n : w));
  const effectiveTotal = effectiveWeights.reduce((sum, w) => sum + w, 0n);

  const baseWeights = effectiveWeights.map((w) =>
    Number((w * 10_000n) / effectiveTotal),
  );
  const remainders = effectiveWeights
    .map((w, index) => ({
      index,
      remainder: (w * 10_000n) % effectiveTotal,
    }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );

  const leftover = 10_000 - baseWeights.reduce((sum, val) => sum + val, 0);
  for (let i = 0; i < leftover; i++) {
    baseWeights[remainders[i]!.index]!++;
  }

  const result = allocations.map((a, i) => ({
    ...a,
    weightBps: Math.max(1, baseWeights[i] ?? 0),
  }));

  // Re-verify exact 10,000 sum conservation
  let sumBps = result.reduce((sum, a) => sum + a.weightBps, 0);
  let diff = 10_000 - sumBps;
  while (diff !== 0) {
    if (diff > 0) {
      result[0]!.weightBps++;
      diff--;
    } else {
      let maxIdx = 0;
      for (let i = 1; i < result.length; i++) {
        if (result[i]!.weightBps > result[maxIdx]!.weightBps) {
          maxIdx = i;
        }
      }
      if (result[maxIdx]!.weightBps > 1) {
        result[maxIdx]!.weightBps--;
        diff++;
      } else {
        break;
      }
    }
  }

  return result;
}

/** Calculate market-cap weighted basis points using live catalog metrics and largest remainder. */
export function calculateMarketCapWeights(
  selected: Array<{ mint: string; symbol: string; name?: string }>,
  catalog: MarketAsset[],
): BasketAllocation[] {
  if (!selected.length || selected.length > MAX_CUSTOM_BASKET_LEGS) {
    throw new Error(`Select between 1 and ${MAX_CUSTOM_BASKET_LEGS} assets.`);
  }
  const byMint = new Map(catalog.map((a) => [a.mint, a]));
  const caps = selected.map((s) => {
    const asset = byMint.get(s.mint);
    const cap = asset?.underlyingMarketCapUsd ?? asset?.marketCapUsd;
    if (cap == null || !Number.isFinite(cap) || cap < 1) {
      throw new Error(
        `Market cap is unavailable for ${s.symbol}. Choose equal or manual weights.`,
      );
    }
    return BigInt(Math.round(cap));
  });
  const totalCap = caps.reduce((sum, c) => sum + c, 0n);
  const weights = caps.map((cap) => Number((cap * 10_000n) / totalCap));
  const remainders = caps
    .map((cap, index) => ({ index, remainder: (cap * 10_000n) % totalCap }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  const leftover = 10_000 - weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < leftover; i++) weights[remainders[i]!.index]!++;
  if (weights.some((weight) => weight <= 0))
    throw new Error(
      "A market-cap weight is too small. Choose equal or manual weights.",
    );
  return selected.map((s, i) => ({
    mint: s.mint,
    symbol: s.symbol,
    name: s.name,
    weightBps: weights[i] ?? 0,
  }));
}
