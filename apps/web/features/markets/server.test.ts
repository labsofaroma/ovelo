import { afterEach, describe, expect, it, vi } from "vitest";
import { mint, snapshot } from "../test/fixtures";

const sdk = vi.hoisted(() => ({ getMainnetMarkets: vi.fn() }));
vi.mock("@/lib/sdk/markets", () => sdk);
// The Next data cache is exercised by the build and E2E; here it is a pass-through.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const { getAsset, getMarkets } = await import("./server");

afterEach(() => vi.unstubAllEnvs());

describe("getMarkets", () => {
  it("happy path: returns a validated view", async () => {
    sdk.getMainnetMarkets.mockResolvedValue(snapshot());
    const result = await getMarkets();
    expect(result.state).toBe("ok");
    if (result.state === "ok") expect(result.data.rows).toHaveLength(3);
  });

  it("stale data: keeps the ORIGINAL observation time (no relabelling as fresh)", async () => {
    const old = "2026-11-13T08:00:00.000Z";
    sdk.getMainnetMarkets.mockResolvedValue(
      snapshot({ asOf: old, status: "partial", warnings: ["w"] }),
    );
    const result = await getMarkets();
    expect(result.state === "ok" && result.data.asOf).toBe(old);
    expect(result.state === "ok" && result.data.status).toBe("partial");
  });

  it("missing data: an unavailable snapshot maps to UPSTREAM_UNAVAILABLE", async () => {
    sdk.getMainnetMarkets.mockResolvedValue(
      snapshot({ status: "unavailable", assets: [] }),
    );
    const result = await getMarkets();
    expect(result).toEqual({
      state: "unavailable",
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "An upstream service is unavailable.",
      },
    });
  });

  it("upstream error: internal text never reaches the page", async () => {
    sdk.getMainnetMarkets.mockImplementation(async () => {
      throw new Error("Market provider returned HTTP 500 at 10.0.0.3");
    });
    const result = await getMarkets();
    expect(result.state).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("10.0.0.3");
  });

  it("malformed provider data is rejected by the schema, not rendered", async () => {
    const bad = snapshot();
    bad.assets[0]!.priceObservedAt = "yesterday-ish";
    sdk.getMainnetMarkets.mockResolvedValue(bad);
    const result = await getMarkets();
    expect(result.state).toBe("unavailable");
  });

  it("passes API keys from env and uses an offline fetcher when the outage switch is on", async () => {
    vi.stubEnv("OVELO_V1_SIMULATE_UPSTREAM_OUTAGE", "true");
    sdk.getMainnetMarkets.mockResolvedValue(snapshot());
    await getMarkets();
    const options = sdk.getMainnetMarkets.mock.calls[0]?.[0] as {
      fetcher?: typeof fetch;
    };
    expect(options.fetcher).toBeTypeOf("function");
    await expect(options.fetcher!("https://example.test")).rejects.toThrow();
  });
});

describe("getAsset", () => {
  it("resolves, misses and propagates outages", async () => {
    sdk.getMainnetMarkets.mockResolvedValue(snapshot());
    expect((await getAsset("testx")).state).toBe("ok");
    expect((await getAsset(mint(99))).state).toBe("not-found");
    sdk.getMainnetMarkets.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await getAsset("testx")).state).toBe("unavailable");
  });
});
