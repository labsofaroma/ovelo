import { formatUnits } from "@aroma/ui/format";
import { FUNDING_TOKENS } from "../../trade/schema";
import { formatUsd } from "../../shared/fixed";
import type { ActivityItem, PortfolioView } from "../schema";

/**
 * A basic summary built ONLY from data we have (B7): the priced value now, how much of it is
 * unpriced, and what this wallet spent through Aroma (confirmed receipts, per funding token).
 * Cost basis is unknown (holdings can come from anywhere), so no profit or loss is computed or
 * estimated. Full P&L arrives with M8.
 */
export function PnLSummary({
  portfolio,
  activity,
}: {
  portfolio: PortfolioView;
  activity: readonly ActivityItem[] | null;
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
          Spent through Aroma (confirmed)
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
        <dt className="text-caption text-muted">Profit and loss</dt>
        <dd className="text-small">
          Not shown: the cost basis of these holdings is unknown. Aroma does not
          estimate it.
        </dd>
      </div>
    </dl>
  );
}
