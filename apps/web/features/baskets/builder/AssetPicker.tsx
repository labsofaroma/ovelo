"use client";

import { Badge, Input, Section } from "@ovelo/ui";
import { Check, Plus, Search } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { MAX_LEGS, MIN_LEGS } from "../../creators/schema";
import { formatUsd } from "../../shared/fixed";
import { formatObservedAt } from "../../shared/freshness";
import { type PickerAsset, searchAssets } from "./assets";

export interface AssetPickerProps {
  assets: readonly PickerAsset[];
  selected: ReadonlySet<string>;
  onToggle: (asset: PickerAsset) => void;
  /** How many results to show at once. */
  limit?: number;
}

/**
 * Search the market snapshot and add assets. Each option is a toggle button (aria-pressed) with
 * its token price, price source and observation time when one was observed. Assets that are not
 * registered or are halted are listed as unavailable with the reason, and cannot be added.
 */
export function AssetPicker({
  assets,
  selected,
  onToggle,
  limit = 30,
}: AssetPickerProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const results = useMemo(
    () => searchAssets(assets, deferred, limit),
    [assets, deferred, limit],
  );
  const full = selected.size >= MAX_LEGS;

  return (
    <Section
      eyebrow="Step 2"
      title="Choose assets"
      description={`Pick ${MIN_LEGS} to ${MAX_LEGS} listed, verified assets. Adding or removing one spreads the weights evenly; fine-tune them in the next step.`}
      actions={
        <span className="inline-flex min-h-7 items-center rounded-full border border-line bg-raised px-3 text-caption font-medium tabular-nums text-ink">
          {selected.size} of {MAX_LEGS} selected
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search by symbol or company
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              id={`${id}-search`}
              type="search"
              value={query}
              autoComplete="off"
              placeholder="Search by symbol or company: AAPLx, Nvidia…"
              aria-describedby={`${id}-count`}
              onChange={(event) => setQuery(event.target.value)}
              className="rounded-full pl-10"
            />
          </div>
          <p
            id={`${id}-count`}
            role="status"
            className="text-caption text-muted"
          >
            {results.length === 0
              ? "No listed asset matches this search."
              : `Showing ${results.length} of ${assets.length} assets. ${selected.size} of ${MAX_LEGS} selected.`}
            {full ? " The basket is full; remove an asset to add another." : ""}
          </p>
        </div>
        <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto pr-1">
          {results.map((asset) => {
            const isSelected = selected.has(asset.mint);
            const disabled = !asset.selectable || (full && !isSelected);
            const observed = asset.priceObservedAt
              ? formatObservedAt(asset.priceObservedAt)
              : null;
            return (
              <li key={asset.mint}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  disabled={disabled}
                  onClick={() => onToggle(asset)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-tile border border-line bg-raised p-3 text-left transition-colors motion-fast hover:enabled:border-border-strong focus-ring disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-border-strong aria-pressed:bg-raised-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-small font-semibold text-ink">
                      {asset.symbol}
                    </span>
                    <span className="truncate text-caption text-muted">
                      {asset.name} · {asset.issuer}
                    </span>
                  </span>
                  {asset.selectable && asset.price ? (
                    <span className="flex flex-col items-end text-right">
                      <span className="text-small font-semibold tabular-nums text-ink">
                        {formatUsd(asset.price)}
                      </span>
                      <span className="text-micro text-muted">
                        {asset.priceSource ?? "Unknown source"}
                        {observed ? ` · ${observed}` : ""}
                      </span>
                    </span>
                  ) : asset.selectable ? (
                    <Badge tone="neutral">No token price observed</Badge>
                  ) : (
                    <Badge tone="warning">
                      {asset.reason ?? "Unavailable"}
                    </Badge>
                  )}
                  <span
                    aria-hidden="true"
                    className={
                      isSelected
                        ? "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-transparent bg-accent text-accent-ink"
                        : "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-muted"
                    }
                  >
                    {isSelected ? (
                      <Check className="size-4" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}
