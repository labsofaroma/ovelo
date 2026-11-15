import { StatTile } from "@ovelo/ui";
import { formatUnits } from "@ovelo/ui/format";
import { FUNDING_TOKENS } from "../../trade/schema";
import { formatUsd } from "../../shared/fixed";
import { pnlCopy, portfolioCopy } from "../copy";
import type { PnlView } from "../pnl/schema";
import type { ActivityItem, PortfolioView } from "../schema";
import { formatBps } from "./PnlPanel";

const s = portfolioCopy.summary;

/**
 * A summary built ONLY from data we have (B7): the priced value now, how much of it is unpriced,
 * what this wallet spent through Ovelo (confirmed receipts, per funding token), (M11) the
 * unrealized P&L over the holdings whose cost basis (Ovelo receipts, exact fills) and price are
 * both known, saying how many were left out, and the SOL balance and holding count read from
 * chain. Nothing is estimated.
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
  const unrealized = pnl ? BigInt(pnl.totals.unrealized.raw) : 0n;
  return (
    <div className="flex flex-col gap-3">
      <StatTile
        size="lg"
        label={s.priced}
        value={formatUsd(portfolio.pricedValue)}
        detail={
          portfolio.unpricedCount > 0
            ? s.unpriced(portfolio.unpricedCount)
            : s.allPriced
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={s.spent}
          value={
            activity === null ? (
              "—"
            ) : spent.size === 0 ? (
              s.spentNone
            ) : (
              <span className="flex flex-col">
                {[...spent].map(([mint, raw]) => {
                  const token = FUNDING_TOKENS.find((t) => t.mint === mint);
                  return (
                    <span key={mint}>
                      {token
                        ? `${formatUnits(raw, token.decimals, { fractionDigits: token.decimals }).text} ${token.symbol}`
                        : `${raw.toString()} raw units`}
                    </span>
                  );
                })}
              </span>
            )
          }
          detail={activity === null ? s.spentUnavailable : undefined}
        />
        <StatTile
          label={pnlCopy.totalsLabel}
          value={
            !pnl || pnl.totals.included === 0 ? (
              "—"
            ) : (
              <span
                className={
                  unrealized > 0n
                    ? "text-up"
                    : unrealized < 0n
                      ? "text-down"
                      : undefined
                }
              >
                {unrealized > 0n ? "+" : ""}
                {formatUsd(pnl.totals.unrealized)}{" "}
                <span className="text-small font-normal">
                  ({formatBps(pnl.totals.unrealizedBps)})
                </span>
              </span>
            )
          }
          detail={
            !pnl
              ? pnlCopy.unavailable
              : pnl.totals.included === 0
                ? pnlCopy.noneKnown
                : pnlCopy.leftOut(pnl.totals.excluded)
          }
        />
        <StatTile
          label={s.sol}
          value={`${formatUnits(BigInt(portfolio.sol.raw), 9, { fractionDigits: 4 }).text} SOL`}
          detail={s.solDetail}
        />
        <StatTile
          label={s.count}
          value={portfolio.holdings.length}
          detail={s.countDetail}
        />
      </div>
    </div>
  );
}
