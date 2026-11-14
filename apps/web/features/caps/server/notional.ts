import "server-only";
import type { Fixed } from "@/features/shared/fixed";
import { FUNDING_TOKENS, USDC_MINT } from "@/features/trade/schema";
import { freshPrices } from "@/features/trade/server/prices";
import { AppError } from "@/server/errors";
import { USDC_DECIMALS } from "../config";

/**
 * The USDC notional of an order (W3): its maximum funding debit, the amount the trade
 * authorization carries (for a basket, the total across every leg). USDC counts 1:1. Any other
 * funding token (USDT, SOL) is valued with the existing price path (Jupiter Price V3, fetched
 * now, so fresh) in bigint fixed-point, rounded UP; without a price the order is refused, never
 * guessed (TRADE_CAP_UNAVAILABLE).
 */
export type PriceLookup = (mint: string) => Promise<Fixed | null>;

export const jupiterPrice: PriceLookup = async (mint) => {
  const response = await freshPrices([mint]);
  return response.prices.find((p) => p.mint === mint)?.price ?? null;
};

const unpriced = (detail: string, cause?: unknown) =>
  new AppError("TRADE_CAP_UNAVAILABLE", {
    publicMessage:
      "This order could not be valued in USDC right now, so the beta limits cannot be checked. Nothing was quoted or sent.",
    detail,
    cause,
  });

export async function usdcNotional(
  inputMint: string,
  raw: bigint,
  price: PriceLookup = jupiterPrice,
): Promise<bigint> {
  if (raw < 0n) throw unpriced("negative amount");
  if (inputMint === USDC_MINT) return raw;
  const token = FUNDING_TOKENS.find((t) => t.mint === inputMint);
  if (!token) throw unpriced("not a funding token");
  let fixed: Fixed | null;
  try {
    fixed = await price(inputMint);
  } catch (cause) {
    throw unpriced("price lookup failed", cause);
  }
  if (!fixed || !/^\d+$/.test(fixed.raw) || BigInt(fixed.raw) <= 0n)
    throw unpriced("no price");
  // raw / 10^d tokens × price.raw / 10^p USD = USDC raw × 10^-6, rounded up.
  const numerator = raw * BigInt(fixed.raw) * 10n ** BigInt(USDC_DECIMALS);
  const denominator = 10n ** BigInt(token.decimals + fixed.decimals);
  return (numerator + denominator - 1n) / denominator;
}
