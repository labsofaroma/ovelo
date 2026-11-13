"use client";

import { RouteError, type RouteErrorProps } from "@/features/shared/components/RouteError";

export default function WatchlistError(props: RouteErrorProps) {
  return <RouteError {...props} title="Your watchlist could not be loaded" />;
}
