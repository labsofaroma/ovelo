"use client";

import { useEffect, useState } from "react";
import { Badge } from "@ovelo/ui";
import { classifyFreshness, type Freshness } from "../freshness";

export interface StaleBadgeProps {
  observedAt: string | null;
  staleAfterMs: number;
  /** Server-side verdict, rendered first so the HTML is truthful without JavaScript. */
  initial: Freshness;
}

/**
 * Re-checks staleness in the browser. Pages are cached (ISR + data cache), so the server's verdict
 * can be minutes old by the time someone reads it; this flips the label to "Stale" when the
 * observation ages past its threshold while the page is open, or was served from cache.
 */
export function StaleBadge({
  observedAt,
  staleAfterMs,
  initial,
}: StaleBadgeProps) {
  const [state, setState] = useState<Freshness>(initial);
  useEffect(() => {
    const check = () =>
      setState(classifyFreshness(observedAt, staleAfterMs, Date.now()));
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [observedAt, staleAfterMs]);

  if (state === "fresh") return null;
  return (
    <Badge tone="warning" data-freshness={state}>
      {state === "stale" ? "Stale" : "Unavailable"}
    </Badge>
  );
}
