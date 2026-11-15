import { z } from "zod";
import { fixedSchema } from "../shared/fixed";

/**
 * View model for v1 market pages, parsed with zod at the server boundary (REWRITE-PLAN §2.4) and
 * stored in the Next data cache as JSON. Every number is a `Fixed` (raw integer + decimals) and
 * every observation keeps its own timestamp and source.
 */

/** Decimals used per field, so values of one field always compare as integers. */
export const DECIMALS = { price: 6, usd: 2, percent: 4 } as const;

export const issuerSchema = z.enum([
  "xstocks",
  "prestocks",
  "backpack",
  "other",
]);
export type Issuer = z.infer<typeof issuerSchema>;

export const kindSchema = z.enum(["equity", "etf", "pre-ipo", "unknown"]);

export const priceSourceSchema = z.enum([
  "jupiter-tokens-v2",
  "jupiter-price-v3",
  "prestocks-issuer",
]);
export type PriceSource = z.infer<typeof priceSourceSchema>;

export const referenceSourceSchema = z.enum(["pyth", "jupiter-stock-data"]);

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "must be an ISO timestamp",
  });

export const marketRowSchema = z.object({
  mint: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string(),
  underlyingSymbol: z.string(),
  issuer: issuerSchema,
  kind: kindSchema,
  logoUrl: z.string().nullable(),
  verified: z.boolean(),
  tradingHalted: z.boolean(),
  tradingNotice: z.string().nullable(),
  sourceUrl: z.string(),
  /** Price of the tradable Solana token. */
  price: fixedSchema.nullable(),
  priceObservedAt: isoTime.nullable(),
  priceSource: priceSourceSchema.nullable(),
  /** 24h change of the token price, in percent. */
  change24h: fixedSchema.nullable(),
  volume24h: fixedSchema.nullable(),
  liquidity: fixedSchema.nullable(),
  marketCap: fixedSchema.nullable(),
  /** Underlying-share reference quote. Never a token fill; shown separately and labelled. */
  reference: z
    .object({
      price: fixedSchema,
      observedAt: isoTime.nullable(),
      source: referenceSourceSchema,
    })
    .nullable(),
});
export type MarketRow = z.infer<typeof marketRowSchema>;

export const basketSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  ticker: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  available: z.boolean(),
  missingSymbols: z.array(z.string()),
  unpricedSymbols: z.array(z.string()),
  /** Weights are integer basis points from lib/sdk (they sum to 10,000 when complete). */
  members: z.array(
    z.object({
      mint: z.string(),
      symbol: z.string(),
      weightBps: z.number().int(),
    }),
  ),
});
export type BasketSummary = z.infer<typeof basketSummarySchema>;

const moverSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  change24h: fixedSchema.nullable(),
  volume24h: fixedSchema.nullable(),
});

export const pulseSchema = z.object({
  totalAssets: z.number().int(),
  tradableAssets: z.number().int(),
  pricedAssets: z.number().int(),
  advancing: z.number().int(),
  declining: z.number().int(),
  unchanged: z.number().int(),
  coveredAssets: z.number().int(),
  volume24h: fixedSchema.nullable(),
  volumeCoveredAssets: z.number().int(),
  /** Highest 24h token volume. Defaulted so a snapshot cached before this field still parses. */
  topVolume: z.array(moverSchema).default([]),
  gainers: z.array(moverSchema),
  losers: z.array(moverSchema),
});
export type Pulse = z.infer<typeof pulseSchema>;

export const marketsViewSchema = z.object({
  asOf: isoTime,
  status: z.enum(["live", "partial"]),
  sources: z.array(z.string()),
  warnings: z.array(z.string()),
  rows: z.array(marketRowSchema),
  baskets: z.array(basketSummarySchema),
  pulse: pulseSchema,
});
export type MarketsView = z.infer<typeof marketsViewSchema>;

/* ---------------------------------------------------------------- URL filters */

export const SORTS = [
  "volume",
  "change",
  "price",
  "marketCap",
  "name",
] as const;
export const ISSUER_FILTERS = [
  "all",
  "xstocks",
  "prestocks",
  "backpack",
] as const;
export const KIND_FILTERS = ["all", "equity", "etf", "pre-ipo"] as const;
export const PAGE_SIZE = 50;

const first = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value;

/**
 * Search params are untrusted. Every field falls back to its default instead of failing, so a
 * hand-edited URL renders the default view rather than an error page.
 */
export const marketFiltersSchema = z.object({
  q: z
    .preprocess(
      first,
      z
        .string()
        .trim()
        .max(40)
        .transform((value) => value.replace(/[^\p{L}\p{N} .-]/gu, ""))
        .catch(""),
    )
    .default(""),
  issuer: z
    .preprocess(first, z.enum(ISSUER_FILTERS).catch("all"))
    .default("all"),
  kind: z.preprocess(first, z.enum(KIND_FILTERS).catch("all")).default("all"),
  sort: z.preprocess(first, z.enum(SORTS).catch("volume")).default("volume"),
  priced: z
    .preprocess(
      first,
      z
        .enum(["1", "0"])
        .transform((value) => value === "1")
        .catch(false),
    )
    .default(false),
  page: z
    .preprocess(first, z.coerce.number().int().min(1).max(1000).catch(1))
    .default(1),
});
export type MarketFilters = z.infer<typeof marketFiltersSchema>;

export function parseMarketFilters(params: unknown): MarketFilters {
  return marketFiltersSchema.parse(
    params && typeof params === "object" ? params : {},
  );
}
