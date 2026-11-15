"use client";

import { Badge, Input } from "@ovelo/ui";
import { Check, Plus } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { MAX_LEGS } from "../../creators/schema";
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
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2 id={`${id}-title`} className="text-title font-semibold">
        Choose assets
      </h2>
      <label htmlFor={`${id}-search`} className="text-small font-semibold">
        Search by symbol or company
      </label>
      <Input
        id={`${id}-search`}
        type="search"
        value={query}
        autoComplete="off"
        placeholder="AAPLx, Nvidia…"
        aria-describedby={`${id}-count`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p id={`${id}-count`} role="status" className="text-caption text-muted">
        {results.length === 0
          ? "No listed asset matches this search."
          : `Showing ${results.length} of ${assets.length} assets. ${selected.size} of ${MAX_LEGS} selected.`}
        {full ? " The basket is full; remove an asset to add another." : ""}
      </p>
      <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1">
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
                className="flex w-full items-center gap-3 rounded-control border border-line px-3 py-2 text-left transition-colors motion-base hover:enabled:bg-raised focus-ring disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-accent aria-pressed:bg-accent-soft"
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong"
                >
                  {isSelected ? (
                    <Check className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body font-semibold">
                    {asset.symbol}
                  </span>
                  <span className="truncate text-caption text-muted">
                    {asset.name} · {asset.issuer}
                  </span>
                </span>
                {asset.selectable && asset.price ? (
                  <span className="flex flex-col items-end text-right">
                    <span className="text-small font-semibold tabular-nums">
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
                  <Badge tone="warning">{asset.reason ?? "Unavailable"}</Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
