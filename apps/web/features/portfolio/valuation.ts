import type { Fixed } from "../shared/fixed";

/**
 * Exact valuation in integers (AGENTS.md rule 5): value = raw amount × price / 10^tokenDecimals,
 * expressed with the price's decimals and truncated toward zero. No float touches an amount.
 */
export function valueOf(
  rawAmount: string,
  tokenDecimals: number,
  price: Fixed | null,
): Fixed | null {
  if (!price || !/^\d+$/.test(rawAmount)) return null;
  const priceRaw = BigInt(price.raw);
  if (priceRaw <= 0n) return null;
  const value = (BigInt(rawAmount) * priceRaw) / 10n ** BigInt(tokenDecimals);
  return { raw: value.toString(), decimals: price.decimals };
}

/** Sum values that may use different decimals, at the largest precision present. */
export function sumFixed(
  values: readonly Fixed[],
  fallbackDecimals = 2,
): Fixed {
  const decimals = values.reduce(
    (max, v) => Math.max(max, v.decimals),
    fallbackDecimals,
  );
  const total = values.reduce(
    (sum, v) => sum + BigInt(v.raw) * 10n ** BigInt(decimals - v.decimals),
    0n,
  );
  return { raw: total.toString(), decimals };
}

/** Allocation in basis points of the priced total (integers; remainder dropped). */
export function allocationBps(value: Fixed, total: Fixed): number {
  const scale = Math.max(value.decimals, total.decimals);
  const v = BigInt(value.raw) * 10n ** BigInt(scale - value.decimals);
  const t = BigInt(total.raw) * 10n ** BigInt(scale - total.decimals);
  if (t <= 0n) return 0;
  return Number((v * 10_000n) / t);
}
