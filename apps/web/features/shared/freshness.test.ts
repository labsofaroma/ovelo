import { describe, expect, it } from "vitest";
import {
  classifyFreshness,
  formatDay,
  formatObservedAt,
  STALE_AFTER_MS,
} from "./freshness";

const now = Date.parse("2026-11-13T12:00:00Z");

describe("classifyFreshness", () => {
  it("is fresh inside the threshold and stale after it", () => {
    expect(
      classifyFreshness("2026-11-13T11:55:00Z", STALE_AFTER_MS.tokenPrice, now),
    ).toBe("fresh");
    expect(
      classifyFreshness("2026-11-13T11:40:00Z", STALE_AFTER_MS.tokenPrice, now),
    ).toBe("stale");
  });
  it("is unavailable without a usable timestamp", () => {
    expect(classifyFreshness(null, 1, now)).toBe("unavailable");
    expect(classifyFreshness(undefined, 1, now)).toBe("unavailable");
    expect(classifyFreshness("not a date", 1, now)).toBe("unavailable");
  });
});

describe("formatting", () => {
  it("is deterministic UTC", () => {
    expect(formatObservedAt("2026-11-13T15:04:59Z")).toBe(
      "13 Nov 2026, 15:04 UTC",
    );
    expect(formatDay("2026-09-13")).toBe("13 Sept 2026");
    expect(formatObservedAt("nope")).toBeNull();
  });
});
