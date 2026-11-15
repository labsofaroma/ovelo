import { formatUnits } from "@ovelo/ui/format";
import { FUNDING_TOKENS } from "../../trade/schema";
import { formatUsd } from "../../shared/fixed";
import { pnlCopy } from "../copy";
import type { PnlView } from "../pnl/schema";
import type { ActivityItem, PortfolioView } from "../schema";
import { formatBps } from "./PnlPanel";

/**
 * A summary built ONLY from data we have (B7): the priced value now, how much of it is unpriced,
 * what this wallet spent through Ovelo (confirmed receipts, per funding token), and (M11) the
 * unrealized P&L over the holdings whose cost basis (Ovelo receipts, exact fills) and price are
 * both known, saying how many were left out. Nothing is estimated.
 */
export function PnLSummary({
  portfolio,
  activity,
  pnl,
}: {
  portfolio: PortfolioView;
  activity: readonly ActivityItem[] | null;
  pnl: PnlView | null;
}) {
  const spent = new Map<string, bigint>();
  for (const item of activity ?? [])
    if (item.status === "confirmed")
      spent.set(
        item.mintIn,
        (spent.get(item.mintIn) ?? 0n) + BigInt(item.amountIn),
      );
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-panel border border-line p-3">
        <dt className="text-caption text-muted">Priced value</dt>
        <dd className="text-title font-semibold tabular-nums">
          {formatUsd(portfolio.pricedValue)}
        </dd>
        <dd className="text-caption text-muted">
          {portfolio.unpricedCount > 0
            ? `${portfolio.unpricedCount} holding${portfolio.unpricedCount === 1 ? "" : "s"} without a price not included`
            : "Every holding is priced"}
        </dd>
      </div>
      <div className="rounded-panel border border-line p-3">
        <dt className="text-caption text-muted">
          Spent through Ovelo (confirmed)
        </dt>
        {activity === null ? (
          <dd className="text-small text-muted">
            Order history is unavailable right now.
          </dd>
        ) : spent.size === 0 ? (
          <dd className="text-small">None recorded</dd>
        ) : (
          [...spent].map(([mint, raw]) => {
            const token = FUNDING_TOKENS.find((t) => t.mint === mint);
            return (
              <dd key={mint} className="text-small tabular-nums">
                {token
                  ? `${formatUnits(raw, token.decimals, { fractionDigits: token.decimals }).text} ${token.symbol}`
                  : `${raw.toString()} raw units`}
              </dd>
            );
          })
        )}
      </div>
      <div className="rounded-panel border border-line p-3">
        <dt className="text-caption text-muted">{pnlCopy.totalsLabel}</dt>
        {!pnl ? (
          <dd className="text-small text-muted">{pnlCopy.unavailable}</dd>
        ) : pnl.totals.included === 0 ? (
          <dd className="text-small">{pnlCopy.noneKnown}</dd>
        ) : (
          <dd className="text-title font-semibold tabular-nums">
            {BigInt(pnl.totals.unrealized.raw) > 0n ? "+" : ""}
            {formatUsd(pnl.totals.unrealized)}{" "}
            <span className="text-small font-normal">
              ({formatBps(pnl.totals.unrealizedBps)})
            </span>
          </dd>
        )}
        {pnl ? (
          <dd className="text-caption text-muted">
            {pnlCopy.leftOut(pnl.totals.excluded)}
          </dd>
        ) : null}
      </div>
    </dl>
  );
}
