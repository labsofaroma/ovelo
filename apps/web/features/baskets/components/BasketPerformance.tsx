import Link from "next/link";
import { cn } from "@aroma/ui";
import { AsOf } from "../../shared/components/AsOf";
import { DataNotice } from "../../shared/components/DataNotice";
import { formatBps, formatPercent, toBigInt } from "../../shared/fixed";
import { formatDay, STALE_AFTER_MS } from "../../shared/freshness";
import { routes } from "../../shared/routes";
import type { Loaded } from "../../shared/upstream";
import { linePath } from "../../stock/chart";
import { RANGES, type PerformanceRange, type PerformanceView } from "../schema";

const LABEL: Record<PerformanceRange, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
};

/**
 * Server-rendered performance view: a static SVG (no client JS) plus the same facts in text.
 * Range switching is plain links (?range=), so it is shareable and works without JavaScript.
 */
export function BasketPerformance({
  basketId,
  range,
  performance,
}: {
  basketId: string;
  range: PerformanceRange;
  performance: Loaded<PerformanceView>;
}) {
  return (
    <section
      aria-labelledby="performance-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="performance-heading" className="text-section font-semibold">
          How these weights would have moved
        </h2>
        <p className="text-small text-muted">
          Hypothetical: the published weights applied to observed daily closes
          of the underlying shares. Past movement, not a return anyone earned,
          and not the token prices.
        </p>
      </div>
      <nav aria-label="Performance range" className="flex gap-1">
        {RANGES.map((value) => (
          <Link
            key={value}
            href={`${routes.basket(basketId)}?range=${value}`}
            aria-current={value === range ? "page" : undefined}
            scroll={false}
            className={cn(
              "inline-flex min-h-(--aroma-control-height) items-center rounded-control px-3 text-small font-semibold focus-ring",
              value === range
                ? "bg-raised text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {LABEL[value]}
          </Link>
        ))}
      </nav>
      {performance.state === "unavailable" ? (
        <DataNotice tone="unavailable" title="Performance is unavailable">
          <p>
            Daily closes for the constituents could not be loaded. No figures
            are shown.
          </p>
        </DataNotice>
      ) : (
        <PerformanceBody view={performance.data} />
      )}
    </section>
  );
}

function PerformanceBody({ view }: { view: PerformanceView }) {
  const path = linePath(view.series, 640, 160);
  const rising = view.change ? toBigInt(view.change) >= 0n : true;
  return (
    <>
      {view.warnings.length ? (
        <DataNotice
          title="Some constituents are missing from this calculation"
          items={view.warnings}
        />
      ) : null}
      <p className="text-body">
        {view.change ? (
          <>
            <strong className="tabular-nums">
              {formatPercent(view.change)}
            </strong>{" "}
            from {view.startDate ? formatDay(view.startDate) : "the start"} to{" "}
            {view.endDate ? formatDay(view.endDate) : "the latest close"}.
          </>
        ) : (
          "The weighted change could not be computed."
        )}
      </p>
      {path ? (
        <svg
          viewBox="0 0 640 160"
          className="h-40 w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={path}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className={rising ? "stroke-up" : "stroke-down"}
          />
        </svg>
      ) : null}
      <ul className="grid gap-2 text-small md:grid-cols-2">
        {view.constituents.map((item) => (
          <li
            key={item.mint}
            className="flex justify-between gap-3 border-b border-line py-1"
          >
            <span>
              {item.symbol}{" "}
              <span className="text-muted">({formatBps(item.weightBps)})</span>
            </span>
            <span className="tabular-nums">
              {item.change ? formatPercent(item.change) : "No history"}
              {item.contribution ? (
                <span className="text-muted">
                  {" "}
                  · {formatPercent(item.contribution)} contribution
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <AsOf
        observedAt={view.asOf}
        source={view.sources.join(", ") || null}
        staleAfterMs={STALE_AFTER_MS.research}
        label="Computed"
      />
    </>
  );
}
