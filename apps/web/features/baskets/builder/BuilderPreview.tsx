"use client";

import { AllocationTable } from "../components/AllocationTable";
import type { BasketSummary, MarketRow } from "../../markets/schema";
import type { WeightRow } from "./WeightEditor";

export interface BuilderPreviewProps {
  name: string;
  ticker: string;
  description: string;
  rows: readonly WeightRow[];
  /** Market rows for the selectable assets (the snapshot the picker used). */
  market: readonly MarketRow[];
  asOf: string;
}

/**
 * The draft rendered with the same AllocationTable as published baskets (M3), so creators see
 * exactly what buyers will. Assets that dropped out of the snapshot show as not listed.
 */
export function BuilderPreview({
  name,
  ticker,
  description,
  rows,
  market,
  asOf,
}: BuilderPreviewProps) {
  const listed = new Set(market.map((row) => row.mint));
  const basket: BasketSummary = {
    id: "draft",
    name: name.trim() || "Untitled basket",
    ticker: ticker.trim().toUpperCase(),
    description,
    category: "custom",
    available: false,
    missingSymbols: rows
      .filter((r) => !listed.has(r.mint))
      .map((r) => r.symbol),
    unpricedSymbols: [],
    members: rows
      .filter((r) => listed.has(r.mint))
      .map(({ mint, symbol, weightBps }) => ({ mint, symbol, weightBps })),
  };
  return (
    <section
      aria-labelledby="builder-preview-title"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="builder-preview-title" className="text-title font-semibold">
          Preview
        </h2>
        <p className="text-small text-muted">
          {basket.name}
          {basket.ticker ? ` (${basket.ticker})` : ""}. This is how the
          allocation will appear to buyers. Nothing is published from this page.
        </p>
      </div>
      {rows.length ? (
        <AllocationTable basket={basket} rows={market} asOf={asOf} />
      ) : (
        <p className="rounded-panel border border-dashed border-line p-4 text-small text-muted">
          No assets yet. Choose at least two to see the allocation.
        </p>
      )}
    </section>
  );
}
