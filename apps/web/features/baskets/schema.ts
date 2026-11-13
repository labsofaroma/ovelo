import { z } from "zod";
import { fixedSchema } from "../shared/fixed";

/** Basket ids come from lib/sdk definitions: lowercase slugs. Anything else is a 404. */
export const basketIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const RANGES = ["30d", "90d", "1y"] as const;
export type PerformanceRange = (typeof RANGES)[number];

export function parseRange(value: unknown): PerformanceRange {
  const text = Array.isArray(value) ? value[0] : value;
  return z.enum(RANGES).catch("90d").parse(text);
}

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));

/**
 * Hypothetical performance: the published weights applied to observed daily closes of the
 * UNDERLYING shares. Percentages only; no "$1,000 became $X" (PRODUCT.md: never invent returns).
 */
export const performanceViewSchema = z.object({
  basketId: z.string(),
  range: z.enum(RANGES),
  asOf: isoTime,
  status: z.enum(["live", "partial"]),
  /** Weighted change over the range, percent with 4 decimals. */
  change: fixedSchema.nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  /** Normalised index (start = 100), two decimals, oldest first. */
  series: z.array(z.object({ date: z.string(), close: fixedSchema })),
  constituents: z.array(
    z.object({
      mint: z.string(),
      symbol: z.string(),
      weightBps: z.number().int(),
      change: fixedSchema.nullable(),
      contribution: fixedSchema.nullable(),
    }),
  ),
  sources: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type PerformanceView = z.infer<typeof performanceViewSchema>;
