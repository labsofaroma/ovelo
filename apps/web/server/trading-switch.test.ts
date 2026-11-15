import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubBaseEnv } from "@/server/test/base-env";
import { assertTradingOpen, tradingOff } from "./trading-switch";

const { middleware } = await import("@/middleware");

/** M9 emergency stop: OVELO_TRADING=off closes every mainnet trading entry point, nothing else. */
beforeEach(() => {
  stubBaseEnv();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("OVELO_COMPLIANCE_MISSING_COUNTRY", "allow");
});
afterEach(() => vi.unstubAllEnvs());

describe("tradingOff / assertTradingOpen", () => {
  it("is off only for an explicit off", () => {
    expect(tradingOff({ OVELO_TRADING: "off" })).toBe(true);
    expect(tradingOff({ OVELO_TRADING: " OFF " })).toBe(true);
    for (const value of [undefined, "on", ""])
      expect(tradingOff({ OVELO_TRADING: value })).toBe(false);
  });

  it("refuses with 503 TRADING_UNAVAILABLE and a plain message", () => {
    expect(() => assertTradingOpen({ OVELO_TRADING: "off" })).toThrow(
      expect.objectContaining({
        code: "TRADING_UNAVAILABLE",
        publicMessage:
          "Trading is paused. Nothing was quoted or sent; try again later.",
      }),
    );
    expect(() => assertTradingOpen({ OVELO_TRADING: "on" })).not.toThrow();
  });
});

describe("middleware with OVELO_TRADING=off", () => {
  const post = (path: string) =>
    middleware(
      new NextRequest(`http://localhost:3000${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "198.51.100.9",
        },
        body: "{}",
      }),
    );

  it.each([
    "/api/v1/trade/quote",
    "/api/v1/trade/submit",
    "/api/v1/actions/baskets/sol-core",
  ])("%s → 503 TRADING_UNAVAILABLE", async (path) => {
    vi.stubEnv("OVELO_TRADING", "off");
    const response = await post(path);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "TRADING_UNAVAILABLE",
    });
  });

  it.each([
    "/api/v1/actions/baskets/sol-core/confirm",
    "/api/v1/plans/7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1/prepare-close",
    "/api/v1/compliance/terms/challenge",
  ])("%s stays open (receipts, plan exits, terms)", async (path) => {
    vi.stubEnv("OVELO_TRADING", "off");
    expect((await post(path)).status).not.toBe(503);
  });

  it("is open again with OVELO_TRADING=on", async () => {
    vi.stubEnv("OVELO_TRADING", "on");
    expect((await post("/api/v1/trade/quote")).status).not.toBe(503);
  });
});

describe("each trading route re-checks it (a matcher change cannot open trading)", () => {
  it.each([
    ["quote", () => import("@/app/api/v1/trade/quote/route")],
    ["submit", () => import("@/app/api/v1/trade/submit/route")],
  ] as const)("%s", async (_name, load) => {
    vi.stubEnv("OVELO_TRADING", "off");
    const { POST } = await load();
    const response = await POST(
      new Request("http://localhost:3000/api/v1/trade/x", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "TRADING_UNAVAILABLE",
      message:
        "Trading is paused. Nothing was quoted or sent; try again later.",
    });
  });
});
