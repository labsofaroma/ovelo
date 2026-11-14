import type { Fixed } from "../../shared/fixed";
import { ISSUER_LABEL, PRICE_SOURCE_LABEL } from "../../markets/labels";
import type { MarketRow } from "../../markets/schema";

/**
 * What the asset picker shows for one asset. Registered (listed and verified by the issuer) and
 * unhalted assets are selectable: the same rule the trade server applies to a live basket (M4
 * decision 4). A catalog token price is shown, with its source and observation time, when one was
 * observed; it is not required, because the Jupiter quote and the simulation price the order.
 */
export type PickerAsset = {
  mint: string;
  symbol: string;
  name: string;
  issuer: string;
  price: Fixed | null;
  priceSource: string | null;
  priceObservedAt: string | null;
  selectable: boolean;
  /** Why it cannot be selected (shown to the user), or null. */
  reason: string | null;
};

export type Exclusions = {
  unverified: number;
  halted: number;
  unpriced: number;
};

export function unselectableReason(row: MarketRow): string | null {
  if (!row.verified) return "Not verified by the issuer";
  if (row.tradingHalted) return "Trading halted";
  return null;
}

export function toPickerAsset(row: MarketRow): PickerAsset {
  const reason = unselectableReason(row);
  return {
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    issuer: ISSUER_LABEL[row.issuer],
    price: row.price,
    priceSource: row.priceSource ? PRICE_SOURCE_LABEL[row.priceSource] : null,
    priceObservedAt: row.priceObservedAt,
    selectable: reason === null,
    reason,
  };
}

/**
 * Split a snapshot into the rows the builder may use, and counts of what was left out and why.
 * `unpriced` counts selectable rows without an observed token price (shown, not excluded).
 */
export function selectableRows(rows: readonly MarketRow[]): {
  rows: MarketRow[];
  excluded: Exclusions;
} {
  const excluded: Exclusions = { unverified: 0, halted: 0, unpriced: 0 };
  const kept: MarketRow[] = [];
  for (const row of rows) {
    if (!row.verified) excluded.unverified += 1;
    else if (row.tradingHalted) excluded.halted += 1;
    else {
      if (!row.price) excluded.unpriced += 1;
      kept.push(row);
    }
  }
  kept.sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.mint.localeCompare(b.mint),
  );
  return { rows: kept, excluded };
}

/** Case-insensitive match on symbol, name or mint; selectable assets first, then by symbol. */
export function searchAssets(
  assets: readonly PickerAsset[],
  query: string,
  limit = 30,
): PickerAsset[] {
  const needle = query.trim().toLowerCase();
  return assets
    .filter(
      (asset) =>
        !needle ||
        asset.symbol.toLowerCase().includes(needle) ||
        asset.name.toLowerCase().includes(needle) ||
        asset.mint.toLowerCase() === needle,
    )
    .sort(
      (a, b) =>
        Number(b.selectable) - Number(a.selectable) ||
        Number(b.symbol.toLowerCase().startsWith(needle)) -
          Number(a.symbol.toLowerCase().startsWith(needle)) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, limit);
}
