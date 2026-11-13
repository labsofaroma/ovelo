"use client";

import { Star } from "lucide-react";
import { cn } from "@aroma/ui";
import { useHydratedWatchlist } from "../useHydratedWatchlist";

export interface WatchToggleProps {
  mint: string;
  symbol: string;
  /** Show the text label next to the star (detail pages). Rows show the star only. */
  showLabel?: boolean;
}

/** Add/remove an asset from this device's watchlist. Disabled until saved picks are loaded. */
export function WatchToggle({
  mint,
  symbol,
  showLabel = false,
}: WatchToggleProps) {
  const { mints, hydrated, toggle } = useHydratedWatchlist();
  const watched = mints.includes(mint);
  // A toggle keeps one name; `aria-pressed` carries the state (WAI-ARIA toggle button pattern).
  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={`Watch ${symbol}`}
      title={
        watched
          ? `${symbol} is on your watchlist`
          : `Add ${symbol} to your watchlist`
      }
      disabled={!hydrated}
      onClick={() => toggle(mint)}
      className={cn(
        "inline-flex min-h-(--aroma-control-height) min-w-(--aroma-control-height) items-center justify-center gap-2 rounded-control border border-transparent px-2 text-small font-semibold transition-colors motion-base focus-ring",
        "hover:bg-raised disabled:cursor-progress disabled:opacity-60",
        showLabel && "border-border-strong px-4",
        watched ? "text-accent" : "text-muted",
      )}
    >
      <Star
        aria-hidden="true"
        className={cn("size-4", watched && "fill-current")}
      />
      {showLabel ? "Watch" : null}
    </button>
  );
}
