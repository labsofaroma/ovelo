import Link from "next/link";
import { Section, cn } from "@ovelo/ui";
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

const WIDTH = 640;
const HEIGHT = 160;
const PAD = 4;

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
    <Section
      eyebrow="Performance"
      title="How these weights would have moved"
      description="Hypothetical: the published weights applied to observed daily closes of the underlying shares. Past movement, not a return anyone earned, and not the token prices."
      actions={
        <nav
          aria-label="Performance range"
          className="inline-flex gap-1 rounded-full border border-line bg-raised p-1"
        >
          {RANGES.map((value) => (
            <Link
              key={value}
              href={`${routes.basket(basketId)}?range=${value}`}
              aria-current={value === range ? "page" : undefined}
              scroll={false}
              className={cn(
                "inline-flex min-h-(--ovelo-control-height-compact) items-center rounded-full px-4 text-small font-medium transition-colors motion-base focus-ring max-md:min-h-(--ovelo-control-height)",
                value === range
                  ? "bg-raised-2 text-ink edge-highlight"
                  : "text-muted hover:text-ink",
              )}
            >
              {LABEL[value]}
            </Link>
          ))}
        </nav>
      }
    >
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
    </Section>
  );
}

function PerformanceBody({ view }: { view: PerformanceView }) {
  const path = linePath(view.series, WIDTH, HEIGHT, PAD);
  const area = path
    ? `${path} L${WIDTH - PAD} ${HEIGHT} L${PAD} ${HEIGHT} Z`
    : "";
  const rising = view.change ? toBigInt(view.change) >= 0n : true;
  return (
    <div className="flex flex-col gap-5">
      {view.warnings.length ? (
        <DataNotice
          title="Some constituents are missing from this calculation"
          items={view.warnings}
        />
      ) : null}
      <div className="flex flex-col gap-2 rounded-tile border border-line bg-raised p-4">
        {view.change ? (
          <>
            <strong
              className={cn(
                "font-display text-[2rem] font-normal leading-none tabular-nums",
                rising ? "text-up" : "text-down",
              )}
            >
              {formatPercent(view.change)}
            </strong>
            <p className="text-small text-muted">
              From {view.startDate ? formatDay(view.startDate) : "the start"} to{" "}
              {view.endDate ? formatDay(view.endDate) : "the latest close"}.
            </p>
          </>
        ) : (
          <p className="text-small text-muted">
            The weighted change could not be computed.
          </p>
        )}
      </div>
      {path ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className={cn(
            "h-40 w-full md:h-52",
            rising ? "text-up" : "text-down",
          )}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient
              id="basket-performance-fill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="currentColor" stopOpacity=".3" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#basket-performance-fill)" />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
      <ul className="flex flex-col divide-y divide-line rounded-tile border border-line">
        {view.constituents.map((item) => (
          <li
            key={item.mint}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-small"
          >
            <span className="font-medium text-ink">
              {item.symbol}{" "}
              <span className="font-normal text-muted tabular-nums">
                ({formatBps(item.weightBps)})
              </span>
            </span>
            <span className="tabular-nums text-ink">
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
    </div>
  );
}
