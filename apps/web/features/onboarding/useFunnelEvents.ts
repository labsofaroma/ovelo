"use client";

import { useEffect, useRef } from "react";
import type { FlowState } from "../trade/flow";
import { buyConfirmed, firstQuote } from "./funnel";

/** Report the first live quote and a confirmed live buy of a trade ticket (consent-gated). */
export function useFunnelEvents(
  state: FlowState,
  target: "spot" | "basket",
): void {
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (state.step === "review" && state.quote.channel === "live")
      firstQuote(target);
    if (
      state.step === "done" &&
      state.outcome === "confirmed" &&
      state.record
    ) {
      const id = state.record.id;
      if (reported.current === id) return;
      reported.current = id;
      buyConfirmed(target);
    }
  }, [state, target]);
}
