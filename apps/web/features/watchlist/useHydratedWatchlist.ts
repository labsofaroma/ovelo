"use client";

import { useEffect } from "react";
import { useWatchlist } from "./store";

/** Rehydrates the persisted watchlist once after mount, then returns the live store state. */
export function useHydratedWatchlist() {
  const state = useWatchlist();
  useEffect(() => {
    if (!useWatchlist.getState().hydrated)
      void useWatchlist.persist.rehydrate();
  }, []);
  return state;
}
