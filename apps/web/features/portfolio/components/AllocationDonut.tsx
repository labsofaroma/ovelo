import type { Holding, PortfolioView } from "../schema";
import { allocationBps } from "../valuation";

/**
 * Allocation of the PRICED value only (integer basis points). Unpriced holdings are listed as
 * excluded, never given a share. The ring is decorative; the legend carries the numbers.
 */
const COLORS = [
  "var(--ovelo-accent)",
  "var(--ovelo-up)",
  "var(--ovelo-warning)",
  "var(--ovelo-down)",
  "var(--ovelo-muted)",
];

export function AllocationDonut({ portfolio }: { portfolio: PortfolioView }) {
  const priced = portfolio.holdings.filter(
    (h): h is Holding & { value: NonNullable<Holding["value"]> } =>
      h.value !== null,
  );
  const total = portfolio.pricedValue;
  if (!priced.length || BigInt(total.raw) === 0n)
    return (
      <p className="text-small text-muted">
        No priced holdings, so there is no allocation to show.
      </p>
    );
  const slices = priced
    .map((h) => ({ symbol: h.symbol, bps: allocationBps(h.value, total) }))
    .sort((a, b) => b.bps - a.bps);
  const top = slices.slice(0, 4);
  const rest = slices.slice(4).reduce((sum, s) => sum + s.bps, 0);
  const shown = rest > 0 ? [...top, { symbol: "Other", bps: rest }] : top;
  const circumference = 2 * Math.PI * 40;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 100 100" width="140" height="140" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--ovelo-line)"
          strokeWidth="14"
        />
        {shown.map((slice, i) => {
          const length = (slice.bps / 10_000) * circumference;
          const element = (
            <circle
              key={slice.symbol}
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="14"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += length;
          return element;
        })}
      </svg>
      <ul
        className="grid gap-1 text-small"
        aria-label="Allocation of priced holdings"
      >
        {shown.map((slice, i) => (
          <li key={slice.symbol} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-full"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            {slice.symbol}: {(slice.bps / 100).toFixed(2)}%
          </li>
        ))}
        {portfolio.unpricedCount > 0 ? (
          <li className="text-muted">
            {portfolio.unpricedCount} unpriced holding
            {portfolio.unpricedCount === 1 ? "" : "s"} excluded
          </li>
        ) : null}
      </ul>
    </div>
  );
}
