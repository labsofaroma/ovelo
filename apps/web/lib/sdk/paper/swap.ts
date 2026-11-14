import type { MarketAsset } from "../markets";
import { paperAssetPrice } from "./orders";
import type { PaperAccount, PaperOrder, PaperSwapQuote } from "./types";

/** A paper quote uses observed prices on both sides and only units already held. */
export function quotePaperSwap(
  account: PaperAccount,
  inputAsset: MarketAsset,
  outputAsset: MarketAsset,
  quantity: number,
  now = new Date().toISOString(),
): PaperSwapQuote {
  if (inputAsset.mint === outputAsset.mint)
    throw new Error("Choose two different assets to swap.");
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Enter a quantity greater than zero.");
  const inputPriceUsd = paperAssetPrice(inputAsset, now);
  const outputPriceUsd = paperAssetPrice(outputAsset, now);
  const holding = account.positions.find(
    (position) => position.mint === inputAsset.mint,
  );
  if (
    !holding ||
    !Number.isFinite(holding.quantity) ||
    quantity > holding.quantity
  )
    throw new Error("Insufficient paper holdings.");
  const valueUsd = quantity * inputPriceUsd;
  const outputQuantity = valueUsd / outputPriceUsd;
  if (
    !Number.isFinite(valueUsd) ||
    valueUsd <= 0 ||
    !Number.isFinite(outputQuantity) ||
    outputQuantity <= 0
  )
    throw new Error("Swap quantity is outside the supported range.");
  return {
    inputMint: inputAsset.mint,
    outputMint: outputAsset.mint,
    inputQuantity: quantity,
    outputQuantity,
    inputPriceUsd,
    outputPriceUsd,
    valueUsd,
    quotedAt: now,
  };
}

/** Commit both ledger legs together. The virtual cash balance is unchanged, including rounding. */
export function executePaperSwap(
  account: PaperAccount,
  inputAsset: MarketAsset,
  outputAsset: MarketAsset,
  quantity: number,
  now = new Date().toISOString(),
): PaperAccount {
  const quote = quotePaperSwap(account, inputAsset, outputAsset, quantity, now);
  const inputPosition = account.positions.find(
    (position) => position.mint === inputAsset.mint,
  )!;
  const outputPosition = account.positions.find(
    (position) => position.mint === outputAsset.mint,
  );
  const remainingQuantity = inputPosition.quantity - quantity;
  const remainingCost =
    inputPosition.costBasisUsd * (remainingQuantity / inputPosition.quantity);
  const outputQuantity = (outputPosition?.quantity ?? 0) + quote.outputQuantity;
  const outputCost = (outputPosition?.costBasisUsd ?? 0) + quote.valueUsd;
  const realizedPnlUsd =
    quote.valueUsd - (inputPosition.costBasisUsd - remainingCost);
  if (
    ![remainingCost, outputQuantity, outputCost, realizedPnlUsd].every(
      Number.isFinite,
    ) ||
    outputQuantity <= 0 ||
    remainingCost < 0 ||
    outputCost < 0
  )
    throw new Error("Swap quantity is outside the supported range.");
  const positions = account.positions.filter(
    (position) =>
      position.mint !== inputAsset.mint && position.mint !== outputAsset.mint,
  );
  if (remainingQuantity > 0)
    positions.push({
      ...inputPosition,
      quantity: remainingQuantity,
      costBasisUsd: remainingCost,
    });
  positions.push({
    mint: outputAsset.mint,
    symbol: outputAsset.symbol,
    quantity: outputQuantity,
    costBasisUsd: outputCost,
  });
  const swapId = `swap-${now}-${account.orders.length + 1}`;
  const sell: PaperOrder = {
    id: `${swapId}-sell`,
    swapId,
    mint: inputAsset.mint,
    symbol: inputAsset.symbol,
    side: "sell",
    quantity,
    priceUsd: quote.inputPriceUsd,
    totalUsd: quote.valueUsd,
    realizedPnlUsd,
    createdAt: now,
  };
  const buy: PaperOrder = {
    id: `${swapId}-buy`,
    swapId,
    mint: outputAsset.mint,
    symbol: outputAsset.symbol,
    side: "buy",
    quantity: quote.outputQuantity,
    priceUsd: quote.outputPriceUsd,
    totalUsd: quote.valueUsd,
    createdAt: now,
  };
  return { ...account, positions, orders: [buy, sell, ...account.orders] };
}
