import { BPS_TOTAL } from "../../creators/schema";

/**
 * Basket weight helpers for the builder. Integer basis points only: no float math, and every
 * rounding choice is deterministic (ties go to the earlier row), so the same input always gives
 * the same weights on every device.
 */

/** n weights summing to exactly 10,000: the remainder goes one bp each to the first rows. */
export function equalWeights(count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError("count must be a non-negative integer");
  if (count === 0) return [];
  const base = Math.floor(BPS_TOTAL / count);
  const remainder = BPS_TOTAL % count;
  return Array.from(
    { length: count },
    (_, i) => base + (i < remainder ? 1 : 0),
  );
}

/**
 * Scale weights proportionally so they sum to exactly 10,000 (largest remainder, BigInt).
 * Zero stays zero; all-zero input becomes equal weights. Negative or fractional input is invalid.
 */
export function normalizeWeights(weights: readonly number[]): number[] {
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0))
    throw new RangeError("weights must be non-negative integers");
  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (total === 0n) return equalWeights(weights.length);
  const scaled = weights.map((w) => BigInt(w) * BigInt(BPS_TOTAL));
  const base = scaled.map((value) => value / total);
  let leftover =
    BigInt(BPS_TOTAL) - base.reduce((sum, value) => sum + value, 0n);
  const order = scaled
    .map((value, index) => ({ index, remainder: value % total }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  for (const { index } of order) {
    if (leftover === 0n) break;
    base[index] = base[index]! + 1n;
    leftover -= 1n;
  }
  return base.map(Number);
}

/**
 * Parse a percentage typed by a person ("12", "12.3", "12.34", "12,34") into basis points.
 * At most two decimals and at most 100%; anything else is null. String arithmetic, no floats.
 */
export function parsePercent(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:[.,](\d{0,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  return bps <= BPS_TOTAL ? bps : null;
}

/** Basis points as an editable percentage: 3334 → "33.34". */
export function bpsToPercentText(bps: number): string {
  return `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}

/** Clamp a weight into 0..10,000 after a keyboard step. */
export const clampBps = (bps: number): number =>
  Math.min(BPS_TOTAL, Math.max(0, Math.round(bps)));
