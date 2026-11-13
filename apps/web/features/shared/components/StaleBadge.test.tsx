// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaleBadge } from "./StaleBadge";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("StaleBadge island", () => {
  it("renders nothing while fresh, then flips to Stale as the page ages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-13T12:00:00Z"));
    render(
      <StaleBadge
        observedAt="2026-11-13T11:59:30Z"
        staleAfterMs={60_000}
        initial="fresh"
      />,
    );
    expect(screen.queryByText("Stale")).toBeNull();
    act(() => {
      vi.setSystemTime(Date.parse("2026-11-13T12:01:00Z"));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Stale")).toBeTruthy();
  });
  it("corrects a cached server verdict on mount", () => {
    render(
      <StaleBadge
        observedAt="2020-01-01T00:00:00Z"
        staleAfterMs={60_000}
        initial="fresh"
      />,
    );
    expect(screen.getByText("Stale")).toBeTruthy();
  });
  it("labels a missing timestamp as unavailable", () => {
    render(
      <StaleBadge observedAt={null} staleAfterMs={1} initial="unavailable" />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});
