import { toBigInt, type Fixed } from "../shared/fixed";
import type { ClosePoint } from "./schema";

export const RANGES = [
  { id: "1m", label: "1M", days: 31 },
  { id: "3m", label: "3M", days: 92 },
  { id: "6m", label: "6M", days: 183 },
  { id: "1y", label: "1Y", days: 366 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** Closes within `days` of the latest close (by calendar date, not by count). */
export function sliceRange(
  points: readonly ClosePoint[],
  days: number,
): ClosePoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const end = Date.parse(last.date);
  if (!Number.isFinite(end)) return [...points];
  const start = end - days * 86_400_000;
  return points.filter((point) => Date.parse(point.date) >= start);
}

export interface RangeSummary {
  first: ClosePoint;
  last: ClosePoint;
  high: Fixed;
  low: Fixed;
  /** Change from first to last close, percent with 4 decimals, exact integer math. */
  change: Fixed | null;
}

export function summarize(points: readonly ClosePoint[]): RangeSummary | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  let high = first.close;
  let low = first.close;
  for (const point of points) {
    if (toBigInt(point.close) > toBigInt(high)) high = point.close;
    if (toBigInt(point.close) < toBigInt(low)) low = point.close;
  }
  const a = toBigInt(first.close);
  const b = toBigInt(last.close);
  // All closes share one decimals value (schema), so the ratio is unit-free.
  const change =
    a > 0n && first.close.decimals === last.close.decimals
      ? { raw: (((b - a) * 1_000_000n) / a).toString(), decimals: 4 }
      : null;
  return { first, last, high, low, change };
}

/**
 * SVG path for the closes. Pixel geometry only: converting to JS numbers here is for drawing,
 * never for a displayed or signed amount (labels are formatted from the Fixed values).
 */
export function linePath(
  points: readonly ClosePoint[],
  width: number,
  height: number,
  pad = 4,
): string {
  if (points.length < 2) return "";
  const values = points.map((point) => Number(point.close.raw));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (value - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
