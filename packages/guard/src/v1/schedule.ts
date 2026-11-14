/**
 * TypeScript mirror of `math.rs` (schedule, delegation terms, leg split, oracle amount) for the
 * keeper and the UI. bigint only. Tests pin it to the same vectors as the Rust unit tests.
 */
import { NO_PERIOD } from "./constants";

const BPS = 10_000n;

export function scheduleIndex(
  now: bigint,
  startsAt: bigint,
  periodSeconds: bigint,
): bigint | null {
  if (now < startsAt || periodSeconds <= 0n) return null;
  return (now - startsAt) / periodSeconds;
}

export type Due = { period: number; newlySkipped: number };

/** Oldest runnable period first; `null` when nothing can run now. */
export function runnablePeriod(
  lastExecuted: number,
  periods: number,
  window: number,
  index: bigint,
): Due | null {
  const next = lastExecuted === NO_PERIOD ? 0n : BigInt(lastExecuted) + 1n;
  if (next >= BigInt(periods) || index < next) return null;
  const oldest = index > BigInt(window) ? index - BigInt(window) : 0n;
  const period = next > oldest ? next : oldest;
  if (period >= BigInt(periods)) return null;
  return { period: Number(period), newlySkipped: Number(period - next) };
}

/** Delegation terms a plan requires: `(1 + window)` installments per period, `window` periods of grace. */
export function delegationTerms(
  fundingAmount: bigint,
  window: number,
  periodSeconds: bigint,
  expiresAt: bigint,
) {
  return {
    amountPerPeriod: fundingAmount * (1n + BigInt(window)),
    expiry: expiresAt + periodSeconds * BigInt(window),
  };
}

/** Funding for each leg; always sums to `fundingAmount`. */
export function legAmounts(
  fundingAmount: bigint,
  weightsBps: readonly number[],
): bigint[] {
  let cumulative = 0n;
  return weightsBps.map((weight) => {
    const lo = (fundingAmount * cumulative) / BPS;
    cumulative += BigInt(weight);
    return (fundingAmount * cumulative) / BPS - lo;
  });
}

export const bpsOf = (amount: bigint, bps: number) =>
  (amount * BigInt(bps)) / BPS;
export const minOut = (expected: bigint, slippageBps: number) =>
  bpsOf(expected, 10_000 - slippageBps);

export const UNIT_MULTIPLIER_FP = 1_000_000_000_000n;

/** Same formula and rounding as `math::expected_out`. */
export function expectedOut(params: {
  amountIn: bigint;
  fundingDecimals: number;
  outputDecimals: number;
  price: bigint;
  expo: number;
  multiplierFp: bigint;
}): bigint {
  if (params.price <= 0n) throw new Error("Price must be positive.");
  if (params.multiplierFp <= 0n)
    throw new Error("Multiplier must be positive.");
  const exp = params.outputDecimals - params.fundingDecimals - params.expo + 12;
  const numerator = params.amountIn * (exp >= 0 ? 10n ** BigInt(exp) : 1n);
  const denominator =
    params.price * params.multiplierFp * (exp < 0 ? 10n ** BigInt(-exp) : 1n);
  return numerator / denominator;
}

/** `math::multiplier_fp_ceil` for a JS number (an IEEE-754 double, as Token-2022 stores it). */
export function multiplierFpCeil(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biased = (bits >> 52n) & 0x7ffn;
  if (bits >> 63n || biased === 0n || biased === 0x7ffn)
    throw new Error("Invalid multiplier.");
  const scaled =
    ((bits & ((1n << 52n) - 1n)) | (1n << 52n)) * UNIT_MULTIPLIER_FP;
  const shift = biased - 1075n;
  if (shift >= 0n) return scaled << shift;
  const q = scaled >> -shift;
  return q << -shift === scaled ? q : q + 1n;
}
