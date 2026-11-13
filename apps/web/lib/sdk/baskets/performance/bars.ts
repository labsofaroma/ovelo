import type { PerformanceOptions } from "./types";

/** The slice of Yahoo's chart response this reader uses; every field is checked before use. */
interface YahooChartPayload {
  chart?: {
    result?: {
      timestamp?: unknown;
      indicators?: { quote?: { close?: unknown }[] };
    }[];
  };
}

export interface ConstituentDailyBar {
  date: string;
  close: number;
}

const historicalBarsCache = new Map<
  string,
  { bars: ConstituentDailyBar[]; expiresAt: number }
>();
const pendingBars = new Map<string, Promise<ConstituentDailyBar[]>>();

/**
 * Loads daily closing prices for an equity ticker over the past year.
 * Shares results across baskets containing the same asset with bounded TTL.
 */
export async function loadConstituentHistoricalBars(
  symbol: string,
  options: PerformanceOptions = {},
): Promise<ConstituentDailyBar[]> {
  const normSymbol = symbol
    .trim()
    .toUpperCase()
    .replace(/^[XPRE]+(?=[A-Z])/, "");
  const providerSymbol = /^[A-Z]{1,6}\.[AB]$/.test(normSymbol)
    ? normSymbol.replace(".", "-")
    : normSymbol;
  const key = `bars:${providerSymbol}`;

  const cached = historicalBarsCache.get(key);
  if (cached && cached.expiresAt > Date.now() && !options.fetcher) {
    return cached.bars;
  }

  const inFlight = pendingBars.get(key);
  if (inFlight && !options.fetcher) return inFlight;

  const operation = (async () => {
    try {
      const encoded = encodeURIComponent(providerSymbol);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d`;
      const timeoutSignal = AbortSignal.timeout(4_000);
      const effectiveSignal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      const res = await (options.fetcher ?? fetch)(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Aroma/1.0 (Thematic Basket Analytics)",
        },
        signal: effectiveSignal,
      });

      if (!res.ok) return [];
      const payload = (await res.json()) as YahooChartPayload | null;
      const result = payload?.chart?.result?.[0];
      if (!result) return [];

      const timestamps: number[] = Array.isArray(result.timestamp)
        ? (result.timestamp as number[])
        : [];
      const quote = result.indicators?.quote?.[0];
      const closes: (number | null)[] = Array.isArray(quote?.close)
        ? (quote.close as (number | null)[])
        : [];

      const bars: ConstituentDailyBar[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        const close = closes[i];
        if (
          ts &&
          typeof close === "number" &&
          Number.isFinite(close) &&
          close > 0
        ) {
          const d = new Date(ts * 1000).toISOString().slice(0, 10);
          bars.push({ date: d, close });
        }
      }

      bars.sort((a, b) => a.date.localeCompare(b.date));

      if (historicalBarsCache.size >= 256) {
        historicalBarsCache.delete(
          historicalBarsCache.keys().next().value as string,
        );
      }
      historicalBarsCache.set(key, {
        bars,
        expiresAt: Date.now() + 15 * 60_000,
      });

      return bars;
    } catch {
      return [];
    } finally {
      pendingBars.delete(key);
    }
  })();

  pendingBars.set(key, operation);
  return operation;
}
