import { describe, expect, it, vi } from "vitest";
import type { BasketPerformance } from "@/lib/sdk/baskets/performance";
import { toMarketsView } from "../markets/normalize";
import { mint, snapshot } from "../test/fixtures";
import { historyInput, toPerformanceView } from "./normalize";
import { basketIdSchema, parseRange } from "./schema";

const sdk = vi.hoisted(() => ({ fetchBasketHistoricalPerformance: vi.fn() }));
const markets = vi.hoisted(() => ({ getMarkets: vi.fn() }));
vi.mock("@/lib/sdk/baskets/performance", () => sdk);
vi.mock("../markets/server", () => markets);
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
const { getBasketPage } = await import("./server");

const view = toMarketsView(snapshot());

function performance(
  overrides: Partial<BasketPerformance> = {},
): BasketPerformance {
  return {
    basketId: "test-basket",
    timeframe: "90d",
    changePct: 4.5,
    gainLossUsd: 45,
    endValueUsd: 1045,
    baseAmountUsd: 1000,
    asOf: "2026-11-13T12:00:00.000Z",
    constituents: [
      {
        symbol: "TESTx",
        mint: mint(1),
        name: "Test Corp",
        weightBps: 5000,
        weightPct: 50,
        currentPriceUsd: 110,
        startPriceUsd: 100,
        changePct: 10,
        contributionPct: 5,
      },
    ],
    topGainer: null,
    topLoser: null,
    history: [
      { date: "2026-08-14", value: 100, changePct: 0 },
      { date: "2026-11-12", value: 104.5, changePct: 4.5 },
    ],
    status: "live",
    sources: ["Yahoo Finance Daily Closes"],
    warnings: [],
    ...overrides,
  };
}

describe("baskets schema", () => {
  it("validates ids and ranges", () => {
    expect(basketIdSchema.safeParse("tech-giants").success).toBe(true);
    expect(basketIdSchema.safeParse("../x").success).toBe(false);
    expect(parseRange("1y")).toBe("1y");
    expect(parseRange(["junk"])).toBe("90d");
  });
});

describe("historyInput", () => {
  it("passes identity and weights only, never prices", () => {
    const input = historyInput(view.baskets[0]!, view.rows);
    expect(input.assets).toHaveLength(2);
    for (const { asset } of input.assets) {
      expect(asset.priceUsd).toBeNull();
      expect(asset.underlyingPriceUsd).toBeNull();
    }
    expect(input.assets.map((a) => a.weight)).toEqual([5000, 5000]);
  });
});

describe("toPerformanceView", () => {
  it("drops USD gain/loss and keeps percentages as Fixed", () => {
    const out = toPerformanceView(performance(), "90d");
    expect(out.change).toEqual({ raw: "45000", decimals: 4 });
    expect(Object.keys(out)).not.toContain("gainLossUsd");
    expect(Object.keys(out)).not.toContain("endValueUsd");
    expect(out.startDate).toBe("2026-08-14");
  });
  it("throws when nothing could be computed", () => {
    expect(() =>
      toPerformanceView(performance({ status: "unavailable" }), "90d"),
    ).toThrow();
    expect(() =>
      toPerformanceView(performance({ history: [] }), "90d"),
    ).toThrow();
  });
});

describe("getBasketPage", () => {
  it("happy path with allocations from the snapshot", async () => {
    markets.getMarkets.mockResolvedValue({ state: "ok", data: view });
    sdk.fetchBasketHistoricalPerformance.mockResolvedValue(performance());
    const page = await getBasketPage("test-basket", "90d");
    expect(page.state).toBe("ok");
    if (page.state === "ok") {
      expect(page.rows.map((r) => r.symbol)).toEqual(["TESTx", "DOWNx"]);
      expect(page.performance.state).toBe("ok");
    }
  });
  it("partial history keeps its warnings", async () => {
    markets.getMarkets.mockResolvedValue({ state: "ok", data: view });
    sdk.fetchBasketHistoricalPerformance.mockResolvedValue(
      performance({
        status: "partial",
        warnings: ["1 of 2 constituents lacked history"],
      }),
    );
    const page = await getBasketPage("test-basket", "90d");
    if (page.state === "ok" && page.performance.state === "ok")
      expect(page.performance.data.warnings).toEqual([
        "1 of 2 constituents lacked history",
      ]);
    else throw new Error("expected performance");
  });
  it("performance upstream errors degrade the section only", async () => {
    markets.getMarkets.mockResolvedValue({ state: "ok", data: view });
    sdk.fetchBasketHistoricalPerformance.mockImplementation(async () => {
      throw new Error("yahoo exploded at /internal");
    });
    const page = await getBasketPage("test-basket", "1y");
    expect(page.state).toBe("ok");
    expect(JSON.stringify(page)).not.toContain("/internal");
    if (page.state === "ok") expect(page.performance.state).toBe("unavailable");
  });
  it("unknown ids and outages", async () => {
    markets.getMarkets.mockResolvedValue({ state: "ok", data: view });
    expect((await getBasketPage("nope", "90d")).state).toBe("not-found");
    expect((await getBasketPage("Bad Id!", "90d")).state).toBe("not-found");
    markets.getMarkets.mockResolvedValue({
      state: "unavailable",
      error: { code: "UPSTREAM_UNAVAILABLE", message: "m" },
    });
    expect((await getBasketPage("test-basket", "90d")).state).toBe(
      "unavailable",
    );
  });
});
