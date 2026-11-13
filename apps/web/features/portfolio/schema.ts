import { z } from "zod";
import { fixedSchema } from "../shared/fixed";

/**
 * Portfolio view (REWRITE-PLAN §5.3). Balances are raw integers from the chain; values are
 * `Fixed` (raw + decimals) computed with bigint math; every price carries its source and the time
 * it was observed. A holding without an observed token price has `value: null`: it is shown as
 * unpriced, never estimated. Cost basis is never inferred (M8).
 */
const raw = z.string().regex(/^\d+$/);

export const holdingSchema = z.object({
  mint: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().min(0).max(255),
  raw,
  /** In the issuer catalog (an xStock, PreStock or listed security), as opposed to any SPL token. */
  catalog: z.boolean(),
  issuer: z.string().nullable(),
  logoUrl: z.string().nullable(),
  price: fixedSchema.nullable(),
  priceObservedAt: z.string().nullable(),
  priceSource: z.string().nullable(),
  value: fixedSchema.nullable(),
});
export type Holding = z.infer<typeof holdingSchema>;

export const portfolioViewSchema = z.object({
  wallet: z.string(),
  network: z.literal("mainnet-beta"),
  /** When balances were read from chain. */
  observedAt: z.string(),
  sol: z.object({ raw, decimals: z.literal(9) }),
  holdings: z.array(holdingSchema),
  pricedValue: fixedSchema,
  unpricedCount: z.number().int(),
  /** Prices come from the cached issuer snapshot; this is its as-of time. */
  pricesAsOf: z.string().nullable(),
  sources: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type PortfolioView = z.infer<typeof portfolioViewSchema>;

export const walletParamSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const activityItemSchema = z.object({
  signature: z.string(),
  kind: z.enum(["spot", "basket"]),
  status: z.enum(["pending", "confirmed", "failed"]),
  mintIn: z.string(),
  amountIn: raw,
  legs: z.array(
    z.object({
      mint: z.string(),
      outAmount: raw,
      minimumAmount: raw,
    }),
  ),
  basket: z.string().nullable(),
  blockTime: z.string().nullable(),
  createdAt: z.string(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;
