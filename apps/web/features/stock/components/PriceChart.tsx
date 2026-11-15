"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@ovelo/ui";
import { formatPercent, formatUsd, toBigInt } from "../../shared/fixed";
import { formatDay } from "../../shared/freshness";
import {
  linePath,
  RANGES,
  sliceRange,
  summarize,
  type RangeId,
} from "../chart";
import type { ClosePoint } from "../schema";

const WIDTH = 640;
const HEIGHT = 200;

export interface PriceChartProps {
  closes: ClosePoint[];
  symbol: string;
}

/**
 * Daily closes of the underlying share, observed (never smoothed, projected or animated in).
 * The range buttons are the only interaction; the summary sentence carries the same information
 * for screen readers, so the SVG itself is decorative.
 */
export default function PriceChart({ closes, symbol }: PriceChartProps) {
  const [range, setRange] = useState<RangeId>("6m");
  const labelId = useId();
  const days = RANGES.find((item) => item.id === range)?.days ?? 183;
  const points = useMemo(() => sliceRange(closes, days), [closes, days]);
  const summary = useMemo(() => summarize(points), [points]);
  const path = useMemo(() => linePath(points, WIDTH, HEIGHT), [points]);
  const rising =
    summary !== null &&
    toBigInt(summary.last.close) >= toBigInt(summary.first.close);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-labelledby={labelId} className="flex gap-1">
        <span id={labelId} className="sr-only">
          Chart range
        </span>
        {RANGES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={range === item.id}
            onClick={() => setRange(item.id)}
            className={cn(
              "min-h-(--ovelo-control-height-compact) rounded-control px-3 text-caption font-semibold transition-colors motion-base focus-ring max-md:min-h-(--ovelo-control-height)",
              range === item.id
                ? "bg-raised text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {path ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-48 w-full"
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
      ) : (
        <p className="text-small text-muted">
          Not enough observed closes for this range.
        </p>
      )}
      {summary ? (
        <p className="text-small text-ink" aria-live="polite">
          {symbol} underlying close {formatUsd(summary.first.close)} on{" "}
          {formatDay(summary.first.date)} → {formatUsd(summary.last.close)} on{" "}
          {formatDay(summary.last.date)}
          {summary.change ? ` (${formatPercent(summary.change)})` : ""}. Range
          high {formatUsd(summary.high)}, low {formatUsd(summary.low)}.
        </p>
      ) : null}
    </div>
  );
}
