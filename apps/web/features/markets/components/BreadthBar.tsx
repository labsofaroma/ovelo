import type { Pulse } from "../schema";

/**
 * Up / flat / down share of the assets with an observed 24h move. The headline percentage is a
 * plain share of `coveredAssets`; with no covered assets it says "Unavailable", never 0%.
 */
export function BreadthBar({ pulse }: { pulse: Pulse }) {
  const of = pulse.coveredAssets;
  const share = (n: number) => `${of ? (n / of) * 100 : 0}%`;
  const advancingPct = of ? Math.round((pulse.advancing / of) * 100) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-caption font-medium text-muted">Breadth</span>
        <strong className="font-display text-title font-medium tabular-nums text-ink">
          {advancingPct === null ? "Unavailable" : `${advancingPct}%`}
        </strong>
        {advancingPct === null ? null : (
          <span className="text-small text-muted">advancing</span>
        )}
      </div>
      <div
        role="img"
        aria-label={
          of
            ? `${pulse.advancing} up, ${pulse.declining} down, ${pulse.unchanged} flat, of ${of} assets with 24h data`
            : "No asset has 24h change data"
        }
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-raised"
      >
        {of > 0 ? (
          <>
            <span className="bg-up" style={{ width: share(pulse.advancing) }} />
            <span
              className="bg-border-strong"
              style={{ width: share(pulse.unchanged) }}
            />
            <span
              className="bg-down"
              style={{ width: share(pulse.declining) }}
            />
          </>
        ) : null}
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-caption text-muted">
        {(
          [
            ["Up", pulse.advancing, "bg-up"],
            ["Down", pulse.declining, "bg-down"],
            ["Flat", pulse.unchanged, "bg-border-strong"],
          ] as const
        ).map(([label, count, dot]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
            <dt>{label}</dt>
            <dd className="font-semibold tabular-nums text-ink">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
