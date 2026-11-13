import { describe, expect, it, vi } from "vitest";
import { toMarketsView } from "../markets/normalize";
import { mint, research, snapshot } from "../test/fixtures";

const sdk = vi.hoisted(() => ({ getStockResearch: vi.fn() }));
const markets = vi.hoisted(() => ({ getAsset: vi.fn() }));
vi.mock("@/lib/sdk/research/service", () => sdk);
vi.mock("../markets/server", () => markets);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const { getStockPage } = await import("./server");

const view = toMarketsView(snapshot());
const ok = { state: "ok" as const, row: view.rows[0]!, view };

describe("getStockPage", () => {
  it("happy path: listing + research", async () => {
    markets.getAsset.mockResolvedValue(ok);
    sdk.getStockResearch.mockResolvedValue(research());
    const page = await getStockPage("TESTx");
    expect(page.state).toBe("ok");
    if (page.state !== "ok") return;
    expect(page.research.state).toBe("ok");
    if (page.research.state === "ok") {
      expect(page.research.data.closes).toHaveLength(3);
      // The javascript: link is dropped, the rest of the news is kept.
      expect(page.research.data.news.map((n) => n.title)).toEqual([
        "Test Corp ships",
      ]);
    }
  });

  it("invalid segments are a 404, never an upstream call", async () => {
    expect(await getStockPage("../../etc")).toEqual({ state: "not-found" });
    expect(await getStockPage("%E0%A4%A")).toEqual({ state: "not-found" });
    expect(markets.getAsset).not.toHaveBeenCalled();
  });

  it("unknown symbol is not-found", async () => {
    markets.getAsset.mockResolvedValue({ state: "not-found" });
    expect((await getStockPage(mint(9))).state).toBe("not-found");
  });

  it("catalog outage propagates as unavailable", async () => {
    const outage = {
      state: "unavailable" as const,
      error: { code: "UPSTREAM_UNAVAILABLE" as const, message: "x" },
    };
    markets.getAsset.mockResolvedValue(outage);
    expect(await getStockPage("TESTx")).toEqual(outage);
  });

  it("missing research is a degraded section, not a failed page", async () => {
    markets.getAsset.mockResolvedValue(ok);
    sdk.getStockResearch.mockResolvedValue(research({ status: "unavailable" }));
    const page = await getStockPage("TESTx");
    expect(page.state).toBe("ok");
    if (page.state === "ok") expect(page.research.state).toBe("unavailable");
  });

  it("research upstream errors are mapped and never leak details", async () => {
    markets.getAsset.mockResolvedValue(ok);
    sdk.getStockResearch.mockImplementation(async () => {
      throw new Error("Yahoo 429 token=abc123");
    });
    const page = await getStockPage("TESTx");
    expect(JSON.stringify(page)).not.toContain("abc123");
    if (page.state === "ok")
      expect(page.research).toEqual({
        state: "unavailable",
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "An upstream service is unavailable.",
        },
      });
  });

  it("stale research keeps its observation time", async () => {
    markets.getAsset.mockResolvedValue(ok);
    const old = "2026-11-12T00:00:00.000Z";
    sdk.getStockResearch.mockResolvedValue(
      research({ asOf: old, status: "partial", warnings: ["provider slow"] }),
    );
    const page = await getStockPage("TESTx");
    if (page.state === "ok" && page.research.state === "ok") {
      expect(page.research.data.asOf).toBe(old);
      expect(page.research.data.warnings).toEqual(["provider slow"]);
    } else throw new Error("expected research");
  });
});
