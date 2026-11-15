"use client";

import { EmptyState, Section } from "@ovelo/ui";
import { AllocationTable } from "../components/AllocationTable";
import { WeightBar } from "../components/WeightBar";
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
    <Section
      eyebrow="Step 4"
      title="Preview"
      description="This is how the allocation will appear to buyers. Publishing asks your wallet to sign exactly this allocation."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-5">
          <p className="font-display text-title font-normal tracking-[-0.03em] text-ink">
            {basket.name}
            {basket.ticker ? ` (${basket.ticker})` : ""}
          </p>
          {description.trim() ? (
            <p className="text-small leading-body text-muted">{description}</p>
          ) : null}
          <WeightBar
            weights={rows.map((r) => ({ key: r.mint, weightBps: r.weightBps }))}
          />
        </div>
        {rows.length ? (
          <AllocationTable basket={basket} rows={market} asOf={asOf} />
        ) : (
          <EmptyState
            title="No assets yet"
            description="Choose at least two to see the allocation."
          />
        )}
      </div>
    </Section>
  );
}
