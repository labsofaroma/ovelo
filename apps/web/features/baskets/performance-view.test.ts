import { describe, expect, it, vi } from "vitest";
import { toMarketsView } from "../markets/normalize";
import { NOW, snapshot } from "../test/fixtures";

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("../markets/server", () => ({ getMarkets: vi.fn() }));
const { fetchPerformanceView } = await import("./server");

/**
 * End to end through the REAL lib/sdk history engine (no sdk mock), now that the M3 workarounds
 * are gone: the view must contain share closes only and name only contributing sources.
 */
const DAY = 86_400;
function yahoo(closes: number[]) {
  const end = Math.floor(NOW / 1000 / DAY) * DAY;
  return {
    chart: {
      result: [
        {
          timestamp: closes.map((_, i) => end - (closes.length - i) * DAY),
          indicators: { quote: [{ close: closes }] },
        },
      ],
    },
  };
}

describe("basket performance view without M3 workarounds", () => {
  it("a constituent without closes is reported without a change, never priced from its token", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const view = toMarketsView(snapshot());
      const basket = view.baskets[0]!;
      // TEST has 120 daily closes; DOWN (token price 20 in the snapshot) has none.
      const fetcher = (async (input: unknown) => {
        const url = String(input);
        if (url.includes("/chart/TEST"))
          return Response.json(
            yahoo(Array.from({ length: 120 }, (_, i) => 50 + i)),
          );
        return new Response("{}", { status: 404 });
      }) as typeof fetch;
      const out = await fetchPerformanceView(basket, view.rows, "90d", fetcher);
      expect(out.status).toBe("partial");
      expect(out.sources).toEqual(["Yahoo Finance Daily Closes"]);
      const down = out.constituents.find((c) => c.symbol === "DOWNx");
      expect(down?.change).toBeNull();
      expect(out.warnings.join(" ")).toMatch(/1 of 2 constituents/);
    } finally {
      vi.useRealTimers();
    }
  });
});
