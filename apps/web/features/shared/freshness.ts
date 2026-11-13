/**
 * PRODUCT.md: every figure shows its source and as-of time, and stale or unavailable data is shown
 * as such. These thresholds decide when an observation is labelled "stale". They are display rules,
 * not cache lifetimes: a cached page keeps its original timestamps, and the label is re-evaluated in
 * the browser at view time (StaleBadge), so an old cached page never looks fresh.
 */
export const STALE_AFTER_MS = {
  /** Jupiter prices of the tradable Solana token. */
  tokenPrice: 10 * 60_000,
  /** The issuer catalog and price snapshot as a whole. */
  snapshot: 15 * 60_000,
  /** Underlying-share reference quotes (Pyth or Jupiter stock data). */
  reference: 60 * 60_000,
  /** Company research: profile, fundamentals, daily bars, news. */
  research: 6 * 60 * 60_000,
} as const;

export type Freshness = "fresh" | "stale" | "unavailable";

export function classifyFreshness(
  observedAt: string | null | undefined,
  staleAfterMs: number,
  now: number = Date.now(),
): Freshness {
  if (!observedAt) return "unavailable";
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return "unavailable";
  return now - at > staleAfterMs ? "stale" : "fresh";
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hourCycle: "h23",
});

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Deterministic (UTC), so server HTML and hydration agree: "13 Nov 2026, 15:04 UTC". */
export function formatObservedAt(value: string): string | null {
  const at = Date.parse(value);
  return Number.isFinite(at) ? `${DATE_TIME.format(at)} UTC` : null;
}

/** "13 Nov 2026" (UTC). */
export function formatDay(value: string): string | null {
  const at = Date.parse(value);
  return Number.isFinite(at) ? DAY.format(at) : null;
}
