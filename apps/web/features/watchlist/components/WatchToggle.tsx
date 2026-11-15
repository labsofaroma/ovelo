"use client";

import { Bookmark } from "lucide-react";
import { cn } from "@ovelo/ui";
import { useHydratedWatchlist } from "../useHydratedWatchlist";

export interface WatchToggleProps {
  mint: string;
  symbol: string;
  /** Show the text label next to the bookmark (detail pages). Rows show the icon only. */
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
        "inline-flex min-h-(--ovelo-control-height) min-w-(--ovelo-control-height) cursor-pointer items-center justify-center gap-2 rounded-full border px-2 text-small font-semibold transition-colors motion-fast focus-ring",
        "hover:bg-raised-2 hover:text-ink disabled:cursor-progress disabled:opacity-60",
        showLabel && "border-border-strong px-4",
        watched
          ? "border-border-strong bg-raised-2 text-ink"
          : "border-transparent text-muted",
        showLabel && !watched && "border-border-strong",
      )}
    >
      <Bookmark
        aria-hidden="true"
        className={cn("size-4", watched && "fill-current")}
      />
      {showLabel ? "Watch" : null}
    </button>
  );
}
