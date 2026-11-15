"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Bookmark } from "lucide-react";
import { EmptyState } from "@ovelo/ui";
import { routes } from "../../shared/routes";
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
      <p
        role="status"
        className="rounded-tile border border-line bg-raised px-4 py-6 text-center text-small text-muted"
      >
        Loading your watchlist…
      </p>
    );
  if (!mints.length)
    return (
      <div role="status">
        <EmptyState
          title={
            <span className="flex flex-col items-center gap-3">
              <span className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-raised text-muted">
                <Bookmark aria-hidden="true" className="size-5" />
              </span>
              Your watchlist is empty.
            </span>
          }
          description="Use the bookmark next to any listing in Markets to follow it. Your picks stay in this browser."
          action={
            <Link
              href={routes.markets}
              className="inline-flex min-h-(--ovelo-control-height) items-center gap-2 rounded-full bg-accent px-5 text-small font-semibold text-accent-ink transition-colors motion-base hover:bg-accent-hover focus-ring"
            >
              Browse markets
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          }
        />
      </div>
    );
  return <>{children}</>;
}
