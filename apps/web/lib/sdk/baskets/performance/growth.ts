import { BASKET_EQUITY_PYTH_FEEDS, XSTOCKS_PYTH_FEEDS } from "../../pyth/feeds";
import type { MarketAsset } from "../../markets";
import type {
  BasketConstituentPerformance,
  BasketHistoricalPoint,
  BasketMemberInput,
  BasketPerformance,
} from "./types";

/**
 * Extracts and normalizes constituent assets and weight basis points from either
 * a MarketBasket or a client BasketDisplay.
 */
export function extractBasketMembers(basket: unknown): BasketMemberInput[] {
  if (!basket || typeof basket !== "object") return [];
  const b = basket as Record<string, unknown>;

  // Check b.source?.assets first (MarketBasket inside BasketDisplay)
  const source =
    b.source && typeof b.source === "object"
      ? (b.source as Record<string, unknown>)
      : null;
  const rawList = Array.isArray(source?.assets)
    ? (source.assets as unknown[])
    : Array.isArray(b.assets)
      ? (b.assets as unknown[])
      : [];

  if (!rawList.length) return [];
  const count = rawList.length;

  return rawList.map((item, index) => {
    const row =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const asset = (
      row.asset && typeof row.asset === "object" ? row.asset : row
    ) as MarketAsset;
    let weightBps =
      typeof row.weight === "number" && Number.isFinite(row.weight)
        ? Math.round(row.weight)
        : null;
    if (weightBps === null) {
      // Default equal-weight with Largest Remainder distribution
      weightBps = Math.floor(10_000 / count) + (index < 10_000 % count ? 1 : 0);
    }
    return { asset, weightBps };
  });
}

/**
 * Computes the immediate 24-hour growth and hypothetical profit/loss for a basket
 * from live market observations and oracle reference prices.
 */
export function calculateBasket24hGrowth(
  basket: unknown,
  baseAmountUsd = 1000,
): BasketPerformance {
  const b =
    basket && typeof basket === "object"
      ? (basket as Record<string, unknown>)
      : {};
  const basketId = String(b.id || "basket");
  const members = extractBasketMembers(basket);
  const now = new Date().toISOString();

  if (!members.length) {
    return {
      basketId,
      timeframe: "24h",
      changePct: null,
      gainLossUsd: null,
      endValueUsd: null,
      baseAmountUsd,
      asOf: now,
      constituents: [],
      topGainer: null,
      topLoser: null,
      history: [],
      status: "unavailable",
      sources: [],
      warnings: ["Basket has no constituent assets."],
    };
  }

  const sources = new Set<string>();
  const warnings: string[] = [];
  let totalWeightBps = 0;
  let pricedWeightBps = 0;
  let weightedChangeSum = 0;

  const constituents: BasketConstituentPerformance[] = members.map(
    ({ asset, weightBps }) => {
      totalWeightBps += weightBps;
      const weightPct = weightBps / 100;
      const currentPriceUsd =
        asset.priceUsd ?? asset.underlyingPriceUsd ?? null;
      const changePct =
        asset.change24hPct != null && Number.isFinite(asset.change24hPct)
          ? asset.change24hPct
          : null;

      let contributionPct: number | null = null;
      if (changePct !== null) {
        pricedWeightBps += weightBps;
        weightedChangeSum += (weightBps / 10_000) * changePct;
        contributionPct = Number(((weightBps / 10_000) * changePct).toFixed(4));
      }

      if (asset.priceSource) sources.add("Jupiter Token Observations");
      if (asset.isRealTimePyth || asset.underlyingPriceSource === "pyth")
        sources.add("Pyth Network Oracles");
      const upperSym = (
        asset.underlyingSymbol ||
        asset.symbol ||
        ""
      ).toUpperCase();
      if (BASKET_EQUITY_PYTH_FEEDS[upperSym] || XSTOCKS_PYTH_FEEDS[upperSym]) {
        sources.add("Pyth Network Reference Feeds");
      }

      return {
        symbol: asset.symbol || asset.underlyingSymbol,
        mint: asset.mint,
        name: asset.name,
        weightBps,
        weightPct,
        currentPriceUsd,
        startPriceUsd:
          currentPriceUsd !== null && changePct !== null
            ? Number((currentPriceUsd / (1 + changePct / 100)).toFixed(4))
            : null,
        changePct,
        contributionPct,
        underlyingPriceSource:
          asset.underlyingPriceSource ?? asset.priceSource ?? null,
        isRealTimePyth: asset.isRealTimePyth,
      };
    },
  );

  let status: BasketPerformance["status"] = "live";
  let changePct: number | null = null;

  if (pricedWeightBps === 0) {
    status = "unavailable";
    warnings.push(
      "None of the basket constituents have available 24h market price change data.",
    );
  } else if (pricedWeightBps < totalWeightBps) {
    status = "partial";
    const unpricedCount = constituents.filter(
      (c) => c.changePct === null,
    ).length;
    warnings.push(
      `${unpricedCount} of ${constituents.length} constituents have unobserved 24h price changes. Showing weighted return of priced assets.`,
    );
    // Renormalize against the priced subset for fair representation
    changePct = Number(
      ((weightedChangeSum * 10_000) / pricedWeightBps).toFixed(4),
    );
  } else {
    changePct = Number(weightedChangeSum.toFixed(4));
  }

  let gainLossUsd: number | null = null;
  let endValueUsd: number | null = null;
  if (changePct !== null) {
    gainLossUsd = Number(((baseAmountUsd * changePct) / 100).toFixed(2));
    endValueUsd = Number((baseAmountUsd + gainLossUsd).toFixed(2));
  }

  // Identify top driver and worst drag
  const sortedPriced = constituents
    .filter(
      (c): c is BasketConstituentPerformance & { changePct: number } =>
        c.changePct !== null,
    )
    .sort((a, b) => b.changePct - a.changePct);

  const topGainer = sortedPriced[0] ?? null;
  const topLoser =
    sortedPriced.length > 1
      ? (sortedPriced[sortedPriced.length - 1] ?? null)
      : null;

  // Simple 2-point 24h history for instant sparkline
  const history: BasketHistoricalPoint[] =
    changePct !== null
      ? [
          { date: "24h ago", value: 100, changePct: 0 },
          {
            date: "Current",
            value: Number((100 + changePct).toFixed(2)),
            changePct,
          },
        ]
      : [];

  return {
    basketId,
    timeframe: "24h",
    changePct,
    gainLossUsd,
    endValueUsd,
    baseAmountUsd,
    asOf: now,
    constituents,
    topGainer,
    topLoser,
    history,
    status,
    sources: [...sources],
    warnings,
  };
}
