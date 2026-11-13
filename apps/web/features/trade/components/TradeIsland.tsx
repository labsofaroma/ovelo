"use client";

import { QueryProvider } from "../../shared/components/QueryProvider";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import type { TradeTarget } from "../useTradeFlow";
import { TradeTicket } from "./TradeTicket";

/**
 * The only client entry point for trading on a server-rendered page. Props are plain data (the
 * target and its legs from the server snapshot); the wallet stack loads on demand inside.
 */
export function TradeIsland({
  target,
  title,
}: {
  target: TradeTarget;
  title: string;
}) {
  return (
    <QueryProvider>
      <WalletBoundary>
        <TradeTicket target={target} title={title} />
      </WalletBoundary>
    </QueryProvider>
  );
}
