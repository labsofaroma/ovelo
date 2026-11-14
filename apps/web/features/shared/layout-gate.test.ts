import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A1: the stock and basket segment layouts look the id up in the market snapshot to send real 404s.
 * With AROMA_V1_ENABLED off they must 404 before any data access, so a deployed prototype never
 * calls the markets server.
 */
const markets = vi.hoisted(() => ({
  getAsset: vi.fn(),
  getMarkets: vi.fn(),
}));
vi.mock("@/features/markets/server", () => markets);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: StockLayout } =
  await import("@/app/(app)/(shell)/stock/[symbol]/layout");
const { default: BasketLayout } =
  await import("@/app/(app)/(shell)/basket/[id]/layout");

describe("v1 segment layouts are gated before data access", () => {
  const original = process.env.AROMA_V1_ENABLED;
  beforeEach(() => {
    markets.getAsset.mockReset();
    markets.getMarkets.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AROMA_V1_ENABLED;
    else process.env.AROMA_V1_ENABLED = original;
  });

  it("flag off: the stock layout 404s without calling the markets server", async () => {
    delete process.env.AROMA_V1_ENABLED;
    await expect(
      StockLayout({
        children: null,
        params: Promise.resolve({ symbol: "AAPLx" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(markets.getAsset).not.toHaveBeenCalled();
    expect(markets.getMarkets).not.toHaveBeenCalled();
  });

  it("flag off: the basket layout 404s without calling the markets server", async () => {
    process.env.AROMA_V1_ENABLED = "false";
    await expect(
      BasketLayout({
        children: null,
        params: Promise.resolve({ id: "magnificent-7" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(markets.getMarkets).not.toHaveBeenCalled();
    expect(markets.getAsset).not.toHaveBeenCalled();
  });

  it("flag on: the layouts do read the snapshot", async () => {
    process.env.AROMA_V1_ENABLED = "true";
    markets.getAsset.mockResolvedValue({ state: "ok", data: {} });
    markets.getMarkets.mockResolvedValue({
      state: "ok",
      data: { baskets: [{ id: "magnificent-7" }] },
    });
    await expect(
      StockLayout({
        children: "child",
        params: Promise.resolve({ symbol: "AAPLx" }),
      }),
    ).resolves.toBe("child");
    await expect(
      BasketLayout({
        children: "child",
        params: Promise.resolve({ id: "magnificent-7" }),
      }),
    ).resolves.toBe("child");
    expect(markets.getAsset).toHaveBeenCalledTimes(1);
    expect(markets.getMarkets).toHaveBeenCalledTimes(1);
  });
});
