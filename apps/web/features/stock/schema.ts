import { z } from "zod";
import { fixedSchema } from "../shared/fixed";

/** Decimals for research figures (underlying-share prices, ratios, statement values). */
export const RESEARCH_DECIMALS = { price: 4, value: 2 } as const;

/** Route segment: a token symbol (AAPLx) or a mint. Anything else is a 404, not an error. */
export const symbolParamSchema = z
  .string()
  .transform((value) => {
    try {
      return decodeURIComponent(value).trim();
    } catch {
      return "";
    }
  })
  .pipe(
    z.string().regex(/^[A-Za-z0-9.-]{1,24}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  );

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)));
const httpsUrl = z.string().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
});

export const researchViewSchema = z.object({
  asOf: isoTime,
  status: z.enum(["available", "partial"]),
  profile: z
    .object({
      name: z.string(),
      exchange: z.string().nullable(),
      currency: z.string().nullable(),
      sector: z.string().nullable(),
      industry: z.string().nullable(),
      description: z.string().nullable(),
      website: httpsUrl.nullable(),
      sourceUrl: httpsUrl,
      observedAt: isoTime,
    })
    .nullable(),
  /** Daily closes of the UNDERLYING share (not the token), oldest first. */
  closes: z.array(z.object({ date: z.string(), close: fixedSchema })),
  technicals: z
    .object({
      asOf: z.string(),
      close: fixedSchema,
      sma50: fixedSchema.nullable(),
      sma200: fixedSchema.nullable(),
      rsi14: fixedSchema.nullable(),
      high52w: fixedSchema.nullable(),
      low52w: fixedSchema.nullable(),
      trend: z.enum([
        "above-50-day",
        "below-50-day",
        "at-50-day",
        "unavailable",
      ]),
      sourceUrl: httpsUrl,
    })
    .nullable(),
  fundamentals: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      value: fixedSchema,
      unit: z.string(),
      periodEnd: z.string(),
      period: z.enum(["annual", "quarterly"]),
      sourceUrl: httpsUrl,
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["dividend", "split", "filing"]),
      title: z.string(),
      date: z.string(),
      detail: z.string(),
      sourceUrl: httpsUrl,
    }),
  ),
  news: z.array(
    z.object({
      title: z.string(),
      publisher: z.string().nullable(),
      url: httpsUrl,
      publishedAt: isoTime.nullable(),
    }),
  ),
  sources: z.array(z.object({ name: z.string(), url: httpsUrl })),
  warnings: z.array(z.string()),
});
export type ResearchView = z.infer<typeof researchViewSchema>;
export type ClosePoint = ResearchView["closes"][number];
