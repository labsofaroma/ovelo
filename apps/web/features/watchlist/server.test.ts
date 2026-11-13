import { describe, expect, it, vi } from "vitest";
import { toMarketsView } from "../markets/normalize";
import { mint, snapshot } from "../test/fixtures";

const markets = vi.hoisted(() => ({ getMarkets: vi.fn() }));
vi.mock("../markets/server", () => markets);
const { getWatchlist, pickWatched } = await import("./server");

const view = toMarketsView(snapshot());

describe("watchlist server", () => {
  it("keeps the user's order and reports delisted mints", () => {
    const out = pickWatched(view, [mint(2), mint(42), mint(1)]);
    expect(out.rows.map((r) => r.symbol)).toEqual(["DOWNx", "TESTx"]);
    expect(out.missing).toEqual([mint(42)]);
    expect(out.asOf).toBe(view.asOf);
  });
  it("propagates outages without data", async () => {
    const outage = {
      state: "unavailable",
      error: { code: "UPSTREAM_UNAVAILABLE", message: "m" },
    };
    markets.getMarkets.mockResolvedValue(outage);
    expect(await getWatchlist([mint(1)])).toEqual(outage);
    markets.getMarkets.mockResolvedValue({ state: "ok", data: view });
    const ok = await getWatchlist([mint(1)]);
    expect(ok.state === "ok" && ok.data.rows).toHaveLength(1);
  });
});
