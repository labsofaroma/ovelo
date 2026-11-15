"use client";

import { useId, useMemo, useState } from "react";
import { Change, cn } from "@ovelo/ui";
import { changeProp, formatPercent, formatUsd } from "../../shared/fixed";
import { formatDay } from "../../shared/freshness";
import {
  linePath,
  RANGES,
  sliceRange,
  summarize,
  type RangeId,
} from "../chart";
import type { ClosePoint } from "../schema";

const WIDTH = 680;
const HEIGHT = 220;
const PAD = 4;

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
  const gradientId = `${useId().replace(/:/g, "")}-fill`;
  const days = RANGES.find((item) => item.id === range)?.days ?? 183;
  const points = useMemo(() => sliceRange(closes, days), [closes, days]);
  const summary = useMemo(() => summarize(points), [points]);
  const path = useMemo(() => linePath(points, WIDTH, HEIGHT, PAD), [points]);

  return (
    <div className="flex flex-col gap-4">
      {summary ? (
        <div
          aria-hidden="true"
          className="flex flex-wrap items-end justify-between gap-3"
        >
          <div className="flex flex-col gap-1">
            <span className="font-display text-[2rem] leading-none tabular-nums tracking-[-0.03em] text-ink">
              {formatUsd(summary.last.close)}
            </span>
            <span className="inline-flex flex-wrap items-center gap-2 text-small text-muted">
              <Change percent={changeProp(summary.change)} />
              since the first close shown
            </span>
          </div>
          <span className="flex flex-col items-end text-small tabular-nums text-ink">
            {formatDay(summary.last.date)}
            <span className="text-caption text-muted">Daily close</span>
          </span>
        </div>
      ) : null}
      {path ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-48 w-full overflow-visible md:h-56"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity=".18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={WIDTH}
              y1={HEIGHT * fraction}
              y2={HEIGHT * fraction}
              className="stroke-line"
              strokeDasharray="3 6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <g className="text-accent">
            <path
              d={`${path} L${WIDTH - PAD} ${HEIGHT} L${PAD} ${HEIGHT} Z`}
              fill={`url(#${gradientId})`}
            />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
      ) : (
        <p className="text-small text-muted">
          Not enough observed closes for this range.
        </p>
      )}
      {summary ? (
        <div
          aria-hidden="true"
          className="flex justify-between text-caption tabular-nums text-muted"
        >
          <span>{formatDay(summary.first.date)}</span>
          <span>{formatDay(summary.last.date)}</span>
        </div>
      ) : null}
      <div
        role="group"
        aria-labelledby={labelId}
        className="inline-flex w-full max-w-full gap-1 self-start overflow-x-auto rounded-full border border-line bg-raised p-1 sm:w-auto"
      >
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
              "focus-ring min-h-(--ovelo-control-height) flex-1 cursor-pointer rounded-full px-5 text-small font-medium transition-colors motion-fast sm:min-h-9 sm:flex-none",
              range === item.id
                ? "bg-raised-2 text-ink edge-highlight"
                : "text-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {summary ? (
        <p className="text-small text-muted" aria-live="polite">
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
