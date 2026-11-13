import type { MarketAsset } from "../markets";
import type { PaperAccount, PaperOrder, PaperPosition } from "./types";

export function paperAssetPrice(asset: MarketAsset, now: string): number {
  if (!asset.verified || asset.tradingHalted)
    throw new Error("This asset is unavailable for trading.");
  if (
    asset.priceUsd === null ||
    !Number.isFinite(asset.priceUsd) ||
    asset.priceUsd <= 0
  )
    throw new Error("A live market price is required.");
  const age =
    new Date(now).getTime() - new Date(asset.priceObservedAt ?? "").getTime();
  if (!Number.isFinite(age) || age < -30_000 || age > 120_000)
    throw new Error("Refresh market prices before placing an order.");
  return asset.priceUsd;
}

export function executePaperOrder(
  account: PaperAccount,
  asset: MarketAsset,
  side: "buy" | "sell",
  amountUsd: number,
  now = new Date().toISOString(),
): PaperAccount {
  if (side !== "buy" && side !== "sell") throw new Error("Invalid order side.");
  if (!Number.isFinite(amountUsd) || amountUsd <= 0)
    throw new Error("Enter an amount greater than zero.");
  const priceUsd = paperAssetPrice(asset, now);
  const quantity = amountUsd / priceUsd;
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Order quantity is outside the supported range.");
  const existing = account.positions.find(
    (position) => position.mint === asset.mint,
  );
  if (side === "buy" && amountUsd > account.cashUsd + 1e-8)
    throw new Error("Insufficient paper buying power.");
  if (side === "sell" && (!existing || quantity > existing.quantity + 1e-10))
    throw new Error("Insufficient paper holdings.");
  const positions = account.positions.filter(
    (position) => position.mint !== asset.mint,
  );
  const nextQuantity =
    (existing?.quantity ?? 0) + (side === "buy" ? quantity : -quantity);
  const costBasisUsd =
    side === "buy"
      ? (existing?.costBasisUsd ?? 0) + amountUsd
      : (existing?.costBasisUsd ?? 0) *
        (nextQuantity / (existing?.quantity ?? 1));
  if (nextQuantity > 1e-10)
    positions.push({
      mint: asset.mint,
      symbol: asset.symbol,
      quantity: nextQuantity,
      costBasisUsd,
    });
  const order: PaperOrder = {
    id: `${now}-${account.orders.length + 1}-${asset.mint.slice(0, 6)}`,
    mint: asset.mint,
    symbol: asset.symbol,
    side,
    quantity,
    priceUsd,
    totalUsd: amountUsd,
    createdAt: now,
    ...(side === "sell"
      ? {
          realizedPnlUsd:
            amountUsd - ((existing?.costBasisUsd ?? 0) - costBasisUsd),
        }
      : {}),
  };
  return {
    ...account,
    positions,
    cashUsd: Math.max(
      0,
      account.cashUsd + (side === "buy" ? -amountUsd : amountUsd),
    ),
    orders: [order, ...account.orders],
  };
}
