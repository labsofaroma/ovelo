import { formatUsd, toBigInt, type Fixed } from "../../shared/fixed";

/**
 * Low–high band with a marker for the current value (redesign Range). The marker position is
 * pixel geometry from exact integers; the labels are the reported Fixed values.
 */
export function ResearchRange({
  label,
  low,
  high,
  current,
}: {
  label: string;
  low: Fixed | null;
  high: Fixed | null;
  current: Fixed | null;
}) {
  let position: number | null = null;
  if (
    low &&
    high &&
    current &&
    low.decimals === high.decimals &&
    current.decimals === low.decimals
  ) {
    const lo = toBigInt(low);
    const span = toBigInt(high) - lo;
    if (span > 0n) {
      const basis = ((toBigInt(current) - lo) * 10_000n) / span;
      position = Math.max(0, Math.min(100, Number(basis) / 100));
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4">
      <span className="text-caption font-medium text-muted">{label}</span>
      <div className="flex justify-between gap-3 text-small tabular-nums">
        <span className="flex flex-col">
          <span className="text-caption text-muted">Low</span>
          <strong className="text-ink">
            {low ? formatUsd(low) : "Not reported"}
          </strong>
        </span>
        <span className="flex flex-col items-end">
          <span className="text-caption text-muted">High</span>
          <strong className="text-ink">
            {high ? formatUsd(high) : "Not reported"}
          </strong>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-line">
        {position !== null ? (
          <span
            aria-hidden="true"
            className="absolute top-1/2 block size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent"
            style={{ left: `${position}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}
