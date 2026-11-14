import { isAddress } from "@solana/kit";
import { z } from "zod";

const U64_MAX = 2n ** 64n - 1n;
/** Raw USDC units (6 decimals) as a base-10 integer string; > 0 and within u64. */
const usdcRaw = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, "must be a whole number of raw USDC units above 0")
  // The regex reports a malformed value; this only adds the u64 bound (zod runs both).
  .refine((value) => !/^\d+$/.test(value) || BigInt(value) <= U64_MAX, {
    message: "exceeds u64",
  });

/**
 * Phase A private beta variables (REWRITE-PLAN §7.3 W2). Format-checked at boot with the rest of
 * the environment; features/beta/config.ts resolves the defaults (the gate is ON in production
 * unless `off` is set explicitly) and fails closed on anything it cannot read.
 */
export const betaShape = {
  /** `on` | `off`. Unset: on when NODE_ENV or VERCEL_ENV is production, off in development. */
  AROMA_BETA_GATE: z.enum(["on", "off"]).optional(),
  /** Optional allowlist: comma-separated base58 wallet addresses with beta access. */
  AROMA_BETA_WALLETS: z
    .string()
    .refine(
      (value) => {
        const parts = value.split(",").map((part) => part.trim());
        return (
          parts.length <= 500 &&
          parts.every(
            (part) =>
              /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(part) && isAddress(part),
          )
        );
      },
      {
        message:
          "must be comma-separated base58 wallet addresses (at most 500)",
      },
    )
    .optional(),
  /** W3: per-trade cap in raw USDC units (6 decimals). Beta default 50000000 ($50). */
  AROMA_MAX_TRADE_USDC_RAW: usdcRaw.optional(),
  /** W3: per-wallet, per-UTC-day cap in raw USDC units. Beta default 200000000 ($200). */
  AROMA_MAX_DAILY_USDC_RAW: usdcRaw.optional(),
};

type Ctx = {
  addIssue(issue: { code: "custom"; path: string[]; message: string }): void;
};

/** W3: in a production deployment with v1 on, both caps are required (0 is refused above). */
export function capRules(
  env: {
    VERCEL_ENV?: string;
    AROMA_MAX_TRADE_USDC_RAW?: string;
    AROMA_MAX_DAILY_USDC_RAW?: string;
  },
  ctx: Ctx,
): void {
  if (env.VERCEL_ENV === "production")
    for (const key of [
      "AROMA_MAX_TRADE_USDC_RAW",
      "AROMA_MAX_DAILY_USDC_RAW",
    ] as const)
      if (!env[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "is required in production (raw USDC units above 0)",
        });
  if (
    env.AROMA_MAX_TRADE_USDC_RAW &&
    env.AROMA_MAX_DAILY_USDC_RAW &&
    /^\d+$/.test(env.AROMA_MAX_TRADE_USDC_RAW) &&
    /^\d+$/.test(env.AROMA_MAX_DAILY_USDC_RAW) &&
    BigInt(env.AROMA_MAX_DAILY_USDC_RAW) < BigInt(env.AROMA_MAX_TRADE_USDC_RAW)
  )
    ctx.addIssue({
      code: "custom",
      path: ["AROMA_MAX_DAILY_USDC_RAW"],
      message: "must be at least AROMA_MAX_TRADE_USDC_RAW",
    });
}
