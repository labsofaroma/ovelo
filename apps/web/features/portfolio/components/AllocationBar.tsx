import { EmptyState } from "@ovelo/ui";
import { portfolioCopy } from "../copy";
import type { Holding, PortfolioView } from "../schema";
import { allocationBps } from "../valuation";

const c = portfolioCopy.allocation;

/** Silver steps, darkest last. Each segment is also named in the legend, never colour alone. */
const TONES = ["bg-ink", "bg-ink/75", "bg-ink/55", "bg-ink/38", "bg-ink/22"];

/**
 * Allocation of the PRICED value only (integer basis points). Unpriced holdings are listed as
 * excluded, never given a share. The bar is decorative; the legend carries the numbers.
 */
export function AllocationBar({ portfolio }: { portfolio: PortfolioView }) {
  const priced = portfolio.holdings.filter(
    (h): h is Holding & { value: NonNullable<Holding["value"]> } =>
      h.value !== null,
  );
  const total = portfolio.pricedValue;
  if (!priced.length || BigInt(total.raw) === 0n)
    return <EmptyState title={c.empty} />;
  const slices = priced
    .map((h) => ({ symbol: h.symbol, bps: allocationBps(h.value, total) }))
    .sort((a, b) => b.bps - a.bps);
  const top = slices.slice(0, 4);
  const rest = slices.slice(4).reduce((sum, s) => sum + s.bps, 0);
  const shown = rest > 0 ? [...top, { symbol: c.other, bps: rest }] : top;
  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex h-3 w-full gap-1 overflow-hidden rounded-full"
        aria-hidden="true"
      >
        {shown.map((slice, i) => (
          <span
            key={slice.symbol}
            className={`${TONES[i] ?? TONES[4]} h-full rounded-full`}
            style={{ flexGrow: slice.bps, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul
        aria-label={c.label}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
      >
        {shown.map((slice, i) => (
          <li
            key={slice.symbol}
            className="flex items-center gap-3 rounded-tile border border-line bg-raised px-4 py-3"
          >
            <span
              aria-hidden="true"
              className={`${TONES[i] ?? TONES[4]} size-2.5 shrink-0 rounded-full`}
            />
            <span className="min-w-0 flex-1 truncate text-small text-ink">
              {slice.symbol}
            </span>
            <span className="text-small font-medium text-ink tabular-nums">
              {(slice.bps / 100).toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
      {portfolio.unpricedCount > 0 ? (
        <p className="text-small text-muted">
          {c.excluded(portfolio.unpricedCount)}
        </p>
      ) : null}
    </div>
  );
}
