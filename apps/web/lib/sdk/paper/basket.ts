import type { WeightedAllocation } from "../baskets/atomic-swap";
import {
  calculateBasketRebalance,
  type BasketDrift,
} from "../baskets/rebalance";
import type { MarketAsset, MarketBasket } from "../markets";
import { executePaperOrder } from "./orders";
import type { PaperAccount } from "./types";

export function executePaperBasket(
  account: PaperAccount,
  basket: MarketBasket,
  amountUsd: number,
  now = new Date().toISOString(),
): PaperAccount {
  if (
    !basket.available ||
    basket.assets.reduce((sum, item) => sum + item.weight, 0) !== 10_000
  )
    throw new Error(
      "All basket assets must be available and allocations must total 100%.",
    );
  if (
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    amountUsd > account.cashUsd
  )
    throw new Error("Enter an amount within your paper buying power.");
  return basket.assets.reduce(
    (next, item) =>
      executePaperOrder(
        next,
        item.asset,
        "buy",
        (amountUsd * item.weight) / 10_000,
        now,
      ),
    account,
  );
}

export function executePaperRebalance(
  account: PaperAccount,
  targets: readonly WeightedAllocation[],
  assets: MarketAsset[],
  thresholdBps = 500,
  now = new Date().toISOString(),
): { account: PaperAccount; rebalanced: boolean; legs: BasketDrift[] } {
  const byMint = new Map(assets.map((a) => [a.mint, a]));
  const holdings = targets.map((t) => {
    const pos = account.positions.find((p) => p.mint === t.mint);
    const asset = byMint.get(t.mint);
    const price = asset?.priceUsd ?? 0;
    const valueMicros = BigInt(
      Math.round((pos?.quantity ?? 0) * price * 1_000_000),
    );
    return { mint: t.mint, valueUsdMicros: valueMicros };
  });

  const plan = calculateBasketRebalance({
    targets,
    holdings,
    cashUsdMicros: 0n,
    thresholdBps,
  });

  const needsRebalance = plan.legs.some(
    (l: BasketDrift) => l.action === "buy" || l.action === "sell",
  );
  if (!needsRebalance) return { account, rebalanced: false, legs: plan.legs };

  let next = account;
  for (const leg of plan.legs.filter((l: BasketDrift) => l.action === "sell")) {
    const asset = byMint.get(leg.mint);
    if (!asset) continue;
    const sellUsd = Number(-leg.deltaValueUsdMicros) / 1_000_000;
    if (sellUsd > 0.01) {
      next = executePaperOrder(next, asset, "sell", sellUsd, now);
    }
  }
  for (const leg of plan.legs.filter((l: BasketDrift) => l.action === "buy")) {
    const asset = byMint.get(leg.mint);
    if (!asset) continue;
    const buyUsd = Number(leg.deltaValueUsdMicros) / 1_000_000;
    if (buyUsd > 0.01 && buyUsd <= next.cashUsd + 1e-6) {
      next = executePaperOrder(
        next,
        asset,
        "buy",
        Math.min(buyUsd, next.cashUsd),
        now,
      );
    }
  }

  return { account: next, rebalanced: true, legs: plan.legs };
}
