"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { routes } from "../../shared/routes";
import { textLink } from "../../shared/styles";
import { watchlistSearch } from "../schema";
import { useHydratedWatchlist } from "../useHydratedWatchlist";

export interface WatchlistSyncProps {
  /** Mints the server rendered (from `?m=`). */
  renderedMints: string[];
  /** The server-rendered table for `renderedMints`. */
  children: ReactNode;
}

/**
 * The watchlist lives in this browser (Zustand + localStorage); the data comes from the server.
 * This island mirrors the saved mints into `?m=` so the RSC renders their rows, and keeps the URL
 * in step when the user un-watches something. It renders no market data of its own.
 */
export function WatchlistSync({ renderedMints, children }: WatchlistSyncProps) {
  const { mints, hydrated } = useHydratedWatchlist();
  const router = useRouter();
  const pathname = usePathname() ?? routes.watchlist;
  const inSync = hydrated && mints.join(",") === renderedMints.join(",");

  useEffect(() => {
    if (hydrated && !inSync)
      router.replace(`${pathname}${watchlistSearch(mints)}`, { scroll: false });
  }, [hydrated, inSync, mints, pathname, router]);

  if (!hydrated || !inSync)
    return (
      <p role="status" className="text-small text-muted">
        Loading your watchlist…
      </p>
    );
  if (!mints.length)
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-panel border border-line p-6"
      >
        <p className="text-body">Your watchlist is empty.</p>
        <p className="text-small text-muted">
          Use the star next to any listing in{" "}
          <Link className={textLink} href={routes.markets}>
            Markets
          </Link>{" "}
          to follow it. Your picks stay in this browser.
        </p>
      </div>
    );
  return <>{children}</>;
}
