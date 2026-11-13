import "server-only";
import type { MarketsView } from "@/features/markets/schema";
import { hasIssuerCatalogsForAssets } from "@/lib/sdk/trade/catalogs";
import { AppError } from "@/server/errors";
import type { QuoteRequestBody } from "../schema";
import type { OrderTarget } from "./quote";

/**
 * Resolve the requested stock or basket against the cached issuer catalog (ported from the
 * checks in app/api/trade/order and basket-order.ts). Only issuer-listed, verified, unhalted
 * assets whose issuer catalog is present in the snapshot can be targets; a basket must be
 * complete (no missing constituent, weights summing to 10,000). Discovery-only exchange listings
 * are never rows, so they can never be targets. Funding is limited to USDC, USDT and SOL by the
 * request schema.
 */
export function resolveTarget(
  request: Pick<QuoteRequestBody, "target" | "inputMint">,
  view: MarketsView,
): OrderTarget {
  const byMint = new Map(view.rows.map((row) => [row.mint, row]));
  const legs =
    request.target.kind === "spot"
      ? [{ mint: request.target.mint, weightBps: 10_000, symbol: "" }]
      : (() => {
          const basketId = request.target.basketId;
          const basket = view.baskets.find((b) => b.id === basketId);
          if (!basket)
            throw new AppError("NOT_FOUND", { detail: "unknown basket" });
          if (!basket.available || basket.missingSymbols.length)
            throw new AppError("ASSET_UNAVAILABLE", {
              publicMessage:
                "This basket is missing issuer-listed assets right now. No partial basket will be purchased.",
              detail: `missing: ${basket.missingSymbols.join(",")}`,
            });
          if (
            basket.members.reduce((sum, m) => sum + m.weightBps, 0) !== 10_000
          )
            throw new AppError("ASSET_UNAVAILABLE", {
              detail: "basket weights do not sum to 10,000",
            });
          return basket.members.map((m) => ({ ...m }));
        })();
  const rows = legs.map((leg) => byMint.get(leg.mint));
  if (rows.some((row) => !row))
    throw new AppError("ASSET_UNAVAILABLE", {
      detail: "target mint is not an issuer catalog asset",
    });
  if (legs.some((leg) => leg.mint === request.inputMint))
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: "Choose a funding token different from the asset you buy.",
      detail: "same mint",
    });
  for (const row of rows) {
    if (!row!.verified || row!.tradingHalted)
      throw new AppError("ASSET_UNAVAILABLE", {
        publicMessage: "The issuer has paused trading for this asset.",
        detail: `halted or unverified: ${row!.symbol}`,
      });
  }
  if (
    !hasIssuerCatalogsForAssets(
      { sources: view.sources, status: view.status },
      rows.map((row) => ({ issuer: row!.issuer })),
    )
  )
    throw new AppError("ASSET_UNAVAILABLE", {
      publicMessage:
        "Issuer trading status is temporarily unavailable. Try again once the catalog recovers.",
      detail: "issuer catalog missing from snapshot",
    });
  return {
    kind: request.target.kind,
    basketId: request.target.kind === "basket" ? request.target.basketId : null,
    legs: legs.map((leg, i) => ({
      mint: leg.mint,
      weightBps: leg.weightBps,
      symbol: rows[i]!.symbol,
    })),
  };
}
