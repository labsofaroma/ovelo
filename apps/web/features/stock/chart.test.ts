import { describe, expect, it } from "vitest";
import { linePath, sliceRange, summarize } from "./chart";
import type { ClosePoint } from "./schema";

const point = (date: string, raw: string): ClosePoint => ({
  date,
  close: { raw, decimals: 4 },
});
const points = [
  point("2026-01-01", "1000000"),
  point("2026-06-01", "1500000"),
  point("2026-11-01", "1200000"),
];

describe("chart helpers", () => {
  it("slices by calendar range from the latest close", () => {
    expect(sliceRange(points, 31).map((p) => p.date)).toEqual(["2026-11-01"]);
    expect(sliceRange(points, 183)).toHaveLength(2);
    expect(sliceRange([], 31)).toEqual([]);
  });
  it("summarises with exact integer math", () => {
    const s = summarize(points)!;
    expect(s.high.raw).toBe("1500000");
    expect(s.low.raw).toBe("1000000");
    expect(s.change).toEqual({ raw: "200000", decimals: 4 }); // +20.0000%
    expect(summarize([])).toBeNull();
  });
  it("draws nothing for fewer than two points", () => {
    expect(linePath(points.slice(0, 1), 100, 50)).toBe("");
    expect(linePath(points, 100, 50).startsWith("M")).toBe(true);
  });
});
