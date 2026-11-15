import { z } from "zod";
import { fixedSchema } from "../../shared/fixed";

/**
 * P&L view (M11 Step 2). Cost basis comes ONLY from Aroma's confirmed receipts and the exact fills
 * of their transactions; anything else is "cost basis unknown" with the reason. Cost is in USDC
 * raw units; P&L counts 1 USDC as 1 USD (stated on screen). Nothing is estimated.
 */
const raw = z.string().regex(/^\d+$/);

export const BASIS_STATUSES = [
  /** Every unit held was bought through Aroma with USDC, and every fill was read. */
  "known",
  /** The wallet holds more than Aroma bought: some units came from elsewhere. */
  "outside",
  /** No Aroma purchase of this token. */
  "none",
  /** Some Aroma purchase was paid with SOL or USDT (no USD cost without a price at that time). */
  "other_funding",
  /** A purchase's transaction could not be read yet (the next refresh reads more). */
  "fill_pending",
  /** A funding token itself (USDC, USDT, SOL): no P&L. */
  "funding",
] as const;
export type BasisStatus = (typeof BASIS_STATUSES)[number];

export const pnlRowSchema = z.object({
  mint: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  quantity: raw,
  status: z.enum(BASIS_STATUSES),
  /** Remaining cost basis in USDC raw units (6 decimals), when known. */
  costUsdc: raw.nullable(),
  value: fixedSchema.nullable(),
  priceSource: z.string().nullable(),
  priceObservedAt: z.string().nullable(),
  unrealized: fixedSchema.nullable(),
  /** Unrealized P&L in basis points of the cost, truncated toward zero. */
  unrealizedBps: z.number().int().nullable(),
});
export type PnlRow = z.infer<typeof pnlRowSchema>;

export const basketPnlSchema = z.object({
  basket: z.string(),
  name: z.string(),
  orders: z.number().int(),
  costUsdc: raw.nullable(),
  value: fixedSchema.nullable(),
  unrealized: fixedSchema.nullable(),
  unrealizedBps: z.number().int().nullable(),
  /** Why the P&L is not shown, when it is not. */
  missing: z.enum([...BASIS_STATUSES, "unpriced"]).nullable(),
});
export type BasketPnl = z.infer<typeof basketPnlSchema>;

export const pnlViewSchema = z.object({
  method: z.literal("average-cost"),
  rows: z.array(pnlRowSchema),
  baskets: z.array(basketPnlSchema),
  totals: z.object({
    included: z.number().int(),
    excluded: z.number().int(),
    costUsdc: raw,
    value: fixedSchema,
    unrealized: fixedSchema,
    unrealizedBps: z.number().int().nullable(),
  }),
  /** Aroma records no sales, so realized P&L is not computed. */
  realized: z.null(),
  sources: z.array(z.string()),
});
export type PnlView = z.infer<typeof pnlViewSchema>;
