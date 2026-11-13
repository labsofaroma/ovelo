import {
  loadConstituentHistoricalBars,
  type ConstituentDailyBar,
} from "./bars";
import { calculateBasket24hGrowth, extractBasketMembers } from "./growth";

export const HISTORY_SOURCE = "Yahoo Finance Daily Closes";
import type {
  BasketConstituentPerformance,
  BasketHistoricalPoint,
  BasketPerformance,
  BasketTimeframe,
  PerformanceOptions,
} from "./types";

// ---------------------------------------------------------------------------
// Historical Multi-Timeframe Daily Bars & Performance Engine
// ---------------------------------------------------------------------------

/**
 * Calculates start date cutoff timestamp based on the requested timeframe.
 */
function getTimeframeCutoffDays(
  timeframe: BasketTimeframe,
  nowMs: number,
): number {
  switch (timeframe) {
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "1y":
      return 365;
    case "ytd": {
      const yearStart = new Date(nowMs);
      yearStart.setUTCMonth(0, 1);
      yearStart.setUTCHours(0, 0, 0, 0);
      return Math.max(
        1,
        Math.ceil((nowMs - yearStart.getTime()) / (86400 * 1000)),
      );
    }
  }
}

/**
 * Fetches and builds multi-timeframe historical performance for any basket.
 * Aligns constituent close bars, tracks normalized NAV, and produces attribution.
 *
 * History-only: every start AND end price is an observed daily close of the underlying share. A
 * token price or reference quote is never substituted for a missing close (a different instrument;
 * M3-SDK-REQUESTS #2), so a constituent without closes is reported without a change, and a range
 * with too few closes is "unavailable" rather than silently replaced by 24h token data. `sources`
 * names only the providers whose observations fed the result (#3).
 */
export async function fetchBasketHistoricalPerformance(params: {
  basket: unknown;
  timeframe: BasketTimeframe;
  baseAmountUsd?: number;
  options?: PerformanceOptions;
}): Promise<BasketPerformance> {
  const { basket, timeframe, baseAmountUsd = 1000, options = {} } = params;

  // 24h can be calculated immediately from snapshot prices
  if (timeframe === "24h") {
    return calculateBasket24hGrowth(basket, baseAmountUsd);
  }

  const b =
    basket && typeof basket === "object"
      ? (basket as Record<string, unknown>)
      : {};
  const basketId = String(b.id || "basket");
  const members = extractBasketMembers(basket);
  const nowMs = options.now ? options.now() : Date.now();
  const asOf = new Date(nowMs).toISOString();

  if (!members.length) {
    return {
      basketId,
      timeframe,
      changePct: null,
      gainLossUsd: null,
      endValueUsd: null,
      baseAmountUsd,
      asOf,
      constituents: [],
      topGainer: null,
      topLoser: null,
      history: [],
      status: "unavailable",
      sources: [],
      warnings: ["Basket has no constituent assets."],
    };
  }

  // Load historical bars for all constituents concurrently
  const constituentBarResults = await Promise.allSettled(
    members.map(({ asset }) =>
      loadConstituentHistoricalBars(
        asset.underlyingSymbol || asset.symbol,
        options,
      ),
    ),
  );

  const cutoffDays = getTimeframeCutoffDays(timeframe, nowMs);
  const cutoffDateStr = new Date(nowMs - cutoffDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10);

  const constituentBarsMap = new Map<string, ConstituentDailyBar[]>();
  const warnings: string[] = [];

  members.forEach(({ asset }, idx) => {
    const res = constituentBarResults[idx];
    if (res?.status === "fulfilled" && res.value.length > 0) {
      const assetKey = asset.mint || asset.underlyingSymbol || asset.symbol;
      constituentBarsMap.set(assetKey, res.value);
    }
  });

  const unavailable = (warning: string): BasketPerformance => ({
    basketId,
    timeframe,
    changePct: null,
    gainLossUsd: null,
    endValueUsd: null,
    baseAmountUsd,
    asOf,
    constituents: [],
    topGainer: null,
    topLoser: null,
    history: [],
    status: "unavailable",
    sources: [],
    warnings: [warning],
  });

  if (constituentBarsMap.size === 0) {
    return unavailable(
      `Historical daily bars are temporarily unavailable for timeframe ${timeframe.toUpperCase()}.`,
    );
  }

  // Find all unique trading dates within the cutoff
  const allDates = new Set<string>();
  for (const bars of constituentBarsMap.values()) {
    for (const bar of bars) {
      if (bar.date >= cutoffDateStr) {
        allDates.add(bar.date);
      }
    }
  }

  const sortedDates = [...allDates].sort();
  if (sortedDates.length < 2) {
    return unavailable(
      `Insufficient historical date observations for ${timeframe}.`,
    );
  }

  // Build daily forward-filled price map per constituent
  const filledPrices = new Map<string, Map<string, number>>();
  for (const [key, bars] of constituentBarsMap.entries()) {
    const dateMap = new Map<string, number>();
    let lastClose: number | null = null;
    for (const d of sortedDates) {
      const match = bars.find((b) => b.date === d);
      if (match) {
        lastClose = match.close;
        dateMap.set(d, match.close);
      } else if (lastClose !== null) {
        dateMap.set(d, lastClose);
      }
    }
    filledPrices.set(key, dateMap);
  }

  const startDate = sortedDates[0] as string;
  const endDate = sortedDates[sortedDates.length - 1] as string;

  let totalWeightBps = 0;
  let pricedWeightBps = 0;

  // Compute constituent performance attribution over the period
  const constituents: BasketConstituentPerformance[] = members.map(
    ({ asset, weightBps }) => {
      totalWeightBps += weightBps;
      const weightPct = weightBps / 100;
      const assetKey = asset.mint || asset.underlyingSymbol || asset.symbol;
      const dateMap = filledPrices.get(assetKey);
      const startPrice = dateMap?.get(startDate) ?? null;
      // History-only: never fall back to a token price or reference quote (#2).
      const endPrice = dateMap?.get(endDate) ?? null;

      let changePct: number | null = null;
      let contributionPct: number | null = null;

      if (startPrice !== null && endPrice !== null && startPrice > 0) {
        pricedWeightBps += weightBps;
        changePct = Number(
          (((endPrice - startPrice) / startPrice) * 100).toFixed(4),
        );
        contributionPct = Number(((weightBps / 10_000) * changePct).toFixed(4));
      }

      return {
        symbol: asset.symbol || asset.underlyingSymbol,
        mint: asset.mint,
        name: asset.name,
        weightBps,
        weightPct,
        currentPriceUsd: endPrice,
        startPriceUsd: startPrice,
        changePct,
        contributionPct,
        underlyingPriceSource: "yahoo-finance",
        isRealTimePyth: asset.isRealTimePyth,
      };
    },
  );

  // Build normalized historical NAV series (Base = 100 on startDate)
  const history: BasketHistoricalPoint[] = [];

  for (const date of sortedDates) {
    let dayWeightedValue = 0;
    let dayPricedWeight = 0;

    for (const { asset, weightBps } of members) {
      const assetKey = asset.mint || asset.underlyingSymbol || asset.symbol;
      const dateMap = filledPrices.get(assetKey);
      const startPrice = dateMap?.get(startDate);
      const dayPrice = dateMap?.get(date);

      if (startPrice && dayPrice && startPrice > 0) {
        dayPricedWeight += weightBps;
        const normalizedAssetVal = (dayPrice / startPrice) * 100;
        dayWeightedValue += (weightBps / 10_000) * normalizedAssetVal;
      }
    }

    if (dayPricedWeight > 0) {
      // Re-scale if partial constituents on this date
      const nav = Number(
        ((dayWeightedValue * 10_000) / dayPricedWeight).toFixed(2),
      );
      const pointChangePct = Number((nav - 100).toFixed(2));
      history.push({ date, value: nav, changePct: pointChangePct });
    }
  }

  const finalPoint = history.length > 0 ? history[history.length - 1] : null;
  const changePct = finalPoint ? finalPoint.changePct : null;

  let gainLossUsd: number | null = null;
  let endValueUsd: number | null = null;
  if (changePct !== null) {
    gainLossUsd = Number(((baseAmountUsd * changePct) / 100).toFixed(2));
    endValueUsd = Number((baseAmountUsd + gainLossUsd).toFixed(2));
  }

  let status: BasketPerformance["status"] = "live";
  if (pricedWeightBps === 0) {
    status = "unavailable";
    warnings.push(`Historical data could not be computed for ${timeframe}.`);
  } else if (pricedWeightBps < totalWeightBps) {
    status = "partial";
    const unpriced = constituents.filter((c) => c.changePct === null).length;
    warnings.push(
      `${unpriced} of ${constituents.length} constituents lacked historical price series for ${timeframe}.`,
    );
  }

  const sortedPriced = constituents
    .filter(
      (c): c is BasketConstituentPerformance & { changePct: number } =>
        c.changePct !== null,
    )
    .sort((a, b) => b.changePct - a.changePct);

  return {
    basketId,
    timeframe,
    changePct,
    gainLossUsd,
    endValueUsd,
    baseAmountUsd,
    asOf,
    constituents,
    topGainer: sortedPriced[0] ?? null,
    topLoser:
      sortedPriced.length > 1
        ? (sortedPriced[sortedPriced.length - 1] ?? null)
        : null,
    history,
    status,
    sources: pricedWeightBps > 0 ? [HISTORY_SOURCE] : [],
    warnings,
  };
}
