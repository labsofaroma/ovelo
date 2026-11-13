import type { MarketAsset } from "../markets";
import { paperAssetPrice } from "./orders";
import type { PaperAccount, PaperValuation } from "./types";

export function valuePaperAccount(
  account: PaperAccount,
  assets: MarketAsset[],
): PaperValuation {
  const byMint = new Map(assets.map((asset) => [asset.mint, asset]));
  const unpricedMints = account.positions
    .filter((position) => {
      const price = byMint.get(position.mint)?.priceUsd;
      return price == null || !Number.isFinite(price) || price <= 0;
    })
    .map((position) => position.mint);
  const holdingsUsd = unpricedMints.length
    ? null
    : account.positions.reduce(
        (sum, position) =>
          sum + position.quantity * (byMint.get(position.mint)?.priceUsd ?? 0),
        0,
      );
  const totalUsd = holdingsUsd === null ? null : account.cashUsd + holdingsUsd;
  const profitLossUsd =
    totalUsd === null ? null : totalUsd - account.startingCashUsd;
  return {
    cashUsd: account.cashUsd,
    holdingsUsd,
    totalUsd,
    equityUsd: totalUsd,
    profitLossUsd,
    profitLossPct:
      profitLossUsd === null
        ? null
        : (profitLossUsd / account.startingCashUsd) * 100,
    unpricedMints,
  };
}
