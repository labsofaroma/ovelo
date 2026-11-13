import {
  dateFromSeconds,
  finite,
  list,
  positive,
  row,
  text,
  type Row,
} from "./http";
import type { ResearchBar, ResearchTechnicals } from "./types";

export function parseBars(chart: Row, now: number): ResearchBar[] {
  const meta = row(chart.meta);
  const regular = row(row(meta.currentTradingPeriod).regular);
  const sessionStart = positive(regular.start);
  const sessionEnd = positive(regular.end);
  const knownSession =
    sessionStart !== null &&
    sessionEnd !== null &&
    sessionEnd <= 8.64e12 &&
    sessionEnd > sessionStart &&
    sessionEnd - sessionStart <= 48 * 60 * 60;
  let dayFormatter: Intl.DateTimeFormat;
  try {
    dayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: text(meta.exchangeTimezoneName) || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    dayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const today = dayFormatter.format(now);
  const sessionDate = knownSession
    ? dayFormatter.format(sessionStart * 1000)
    : null;
  const quote = row(list(row(chart.indicators).quote)[0]);
  const [opens, highs, lows, closes, volumes] = [
    "open",
    "high",
    "low",
    "close",
    "volume",
  ].map((key) => list(quote[key])) as [
    unknown[],
    unknown[],
    unknown[],
    unknown[],
    unknown[],
  ];
  const byDate = new Map<string, ResearchBar>();
  list(chart.timestamp)
    .slice(-400)
    .forEach((timestamp, offset, timestamps) => {
      const index = list(chart.timestamp).length - timestamps.length + offset;
      const date = dateFromSeconds(timestamp);
      const open = positive(opens[index]),
        high = positive(highs[index]),
        low = positive(lows[index]),
        close = positive(closes[index]);
      const volume = finite(volumes[index]);
      if (
        !date ||
        Date.parse(date) > now + 60_000 ||
        open === null ||
        high === null ||
        low === null ||
        close === null
      )
        return;
      const barDay = dayFormatter.format(Date.parse(date));
      // Daily chart responses include an unfinished current-session candle.
      // Only use it as a close once the reported regular session has ended.
      if (knownSession && barDay === sessionDate) {
        if (now < sessionEnd * 1000) return;
      } else if (barDay === today) {
        // Without matching session metadata, today's completion is unverified.
        return;
      }
      if (high < Math.max(open, close, low) || low > Math.min(open, close))
        return;
      byDate.set(date, {
        date,
        open,
        high,
        low,
        close,
        volume: volume !== null && volume >= 0 ? volume : null,
      });
    });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Wilder RSI and simple moving averages from observed daily bars; no synthetic points. */
export function calculateResearchTechnicals(
  bars: ResearchBar[],
  sourceUrl: string,
): ResearchTechnicals | null {
  if (!bars.length) return null;
  const closes = bars.map((bar) => bar.close);
  const average = (period: number): number | null =>
    closes.length < period
      ? null
      : closes.slice(-period).reduce((sum, value) => sum + value, 0) / period;
  let rsi14: number | null = null;
  if (closes.length >= 15) {
    let gain = 0,
      loss = 0;
    for (let index = 1; index <= 14; index++) {
      const change = (closes[index] as number) - (closes[index - 1] as number);
      gain += Math.max(change, 0) / 14;
      loss += Math.max(-change, 0) / 14;
    }
    for (let index = 15; index < closes.length; index++) {
      const change = (closes[index] as number) - (closes[index - 1] as number);
      gain = (gain * 13 + Math.max(change, 0)) / 14;
      loss = (loss * 13 + Math.max(-change, 0)) / 14;
    }
    rsi14 =
      gain === 0 && loss === 0
        ? 50
        : loss === 0
          ? 100
          : 100 - 100 / (1 + gain / loss);
  }
  const latest = bars[bars.length - 1] as ResearchBar;
  const sma50 = average(50);
  const volumes = bars.slice(-20).map((bar) => bar.volume);
  const cutoff = Date.parse(latest.date) - 365.25 * 24 * 60 * 60 * 1000;
  const yearBars = bars.filter((bar) => Date.parse(bar.date) >= cutoff);
  const hasYearCoverage =
    yearBars.length >= 200 &&
    Date.parse(latest.date) - Date.parse((yearBars[0] as ResearchBar).date) >=
      360 * 24 * 60 * 60 * 1000;
  return {
    asOf: latest.date,
    close: latest.close,
    sma20: average(20),
    sma50,
    sma200: average(200),
    rsi14,
    high52w: hasYearCoverage
      ? Math.max(...yearBars.map((bar) => bar.high))
      : null,
    low52w: hasYearCoverage
      ? Math.min(...yearBars.map((bar) => bar.low))
      : null,
    averageVolume20:
      volumes.length === 20 && volumes.every((volume) => volume !== null)
        ? volumes.reduce<number>((sum, volume) => sum + (volume ?? 0), 0) / 20
        : null,
    trend:
      sma50 === null
        ? "unavailable"
        : latest.close > sma50
          ? "above-50-day"
          : latest.close < sma50
            ? "below-50-day"
            : "at-50-day",
    basis: "underlying-daily-close",
    sourceUrl,
  };
}
