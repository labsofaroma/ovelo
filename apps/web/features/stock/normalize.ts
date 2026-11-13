import type { StockResearch } from "@/lib/sdk/research/types";
import { fixedFromNumber, type Fixed } from "../shared/fixed";
import {
  RESEARCH_DECIMALS,
  researchViewSchema,
  type ResearchView,
} from "./schema";

const https = (value: string | null | undefined): string | null => {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

const price = (value: number | null | undefined) =>
  value != null && value > 0
    ? fixedFromNumber(value, RESEARCH_DECIMALS.price)
    : null;

const MAX_CLOSES = 400;
const MAX_NEWS = 12;

/**
 * lib/sdk StockResearch → ResearchView. Items with a non-https link are dropped one by one
 * (a bad link must not hide the rest). Throws when nothing usable came back, so the data cache
 * never stores an outage.
 */
export function toResearchView(research: StockResearch): ResearchView {
  if (research.status === "unavailable")
    throw new Error("stock research unavailable");
  const profileSource = https(research.profile?.sourceUrl);
  const technicalsSource = https(research.technicals?.sourceUrl);
  const technicalsClose = price(research.technicals?.close);
  return researchViewSchema.parse({
    asOf: research.asOf,
    status: research.status,
    profile:
      research.profile && profileSource
        ? {
            name: research.profile.name,
            exchange: research.profile.exchange,
            currency: research.profile.currency,
            sector: research.profile.sector,
            industry: research.profile.industry,
            description: research.profile.description,
            website: https(research.profile.website),
            sourceUrl: profileSource,
            observedAt: research.profile.observedAt,
          }
        : null,
    closes: research.bars.slice(-MAX_CLOSES).flatMap((bar) => {
      const close = price(bar.close);
      return close ? [{ date: bar.date, close }] : [];
    }),
    technicals:
      research.technicals && technicalsSource && technicalsClose
        ? {
            asOf: research.technicals.asOf,
            close: technicalsClose,
            sma50: price(research.technicals.sma50),
            sma200: price(research.technicals.sma200),
            rsi14: fixedFromNumber(research.technicals.rsi14, 2),
            high52w: price(research.technicals.high52w),
            low52w: price(research.technicals.low52w),
            trend: research.technicals.trend,
            sourceUrl: technicalsSource,
          }
        : null,
    fundamentals: research.fundamentals.flatMap((item) => {
      const value: Fixed | null = fixedFromNumber(
        item.value,
        RESEARCH_DECIMALS.value,
      );
      const sourceUrl = https(item.sourceUrl);
      return value && sourceUrl ? [{ ...item, value, sourceUrl }] : [];
    }),
    events: research.events.flatMap((item) => {
      const sourceUrl = https(item.sourceUrl);
      return sourceUrl ? [{ ...item, sourceUrl }] : [];
    }),
    news: research.news.slice(0, MAX_NEWS).flatMap((item) => {
      const url = https(item.url);
      return url ? [{ ...item, url }] : [];
    }),
    sources: research.sources.flatMap((item) => {
      const url = https(item.url);
      return url ? [{ name: item.name, url }] : [];
    }),
    warnings: research.warnings,
  });
}
