import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GONE_API_PREFIXES, goneResponse, isGonePath } from "./gone";

const { middleware } = await import("@/middleware");
afterEach(() => vi.unstubAllEnvs());

/** M9: every removed prototype API answers 410 GONE, with Action headers on the old Blink paths. */
const REMOVED = [
  "/api/trade/order",
  "/api/trade/execute",
  "/api/transaction/execute",
  "/api/buy-basket",
  "/api/bundles/execute",
  "/api/bundles/status",
  "/api/recurring",
  "/api/recurring/collect",
  "/api/faucet",
  "/api/creators/challenge",
  "/api/actions/baskets/sol-core",
  "/api/actions/buy-baskets/sol-core",
  "/api/markets",
  "/api/tokens",
  "/api/research",
  "/api/news",
  "/api/portfolio",
  "/api/baskets/performance",
  "/api/health",
];

describe("isGonePath", () => {
  it.each(REMOVED)("%s is gone", (path) => expect(isGonePath(path)).toBe(true));

  it.each([
    "/api/v1/trade/quote",
    "/api/v1/health",
    "/api/v1/actions/baskets/sol-core",
    "/api/marketsx",
    "/actions.json",
    "/markets",
  ])("%s is not", (path) => expect(isGonePath(path)).toBe(false));

  it("covers exactly the removed prototype route families", () => {
    expect([...GONE_API_PREFIXES].sort()).toEqual(
      [
        "actions",
        "baskets",
        "bundles",
        "buy-basket",
        "creators",
        "faucet",
        "health",
        "markets",
        "news",
        "portfolio",
        "recurring",
        "research",
        "tokens",
        "trade",
        "transaction",
      ].sort(),
    );
  });
});

describe("middleware", () => {
  const send = (path: string, method = "GET") =>
    middleware(
      new NextRequest(`http://localhost:3000${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
    );

  it.each(REMOVED)(
    "%s → 410 { code: GONE, message }, before any other guard",
    async (path) => {
      for (const method of ["GET", "POST"]) {
        const response = await send(path, method);
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({
          code: "GONE",
          message:
            "This endpoint was removed. Use the current Ovelo app or its /api/v1 API.",
        });
      }
    },
  );

  it("old Action paths carry the Actions headers (CORS, version, chain), so Blinks fail clearly", async () => {
    const response = await send("/api/actions/buy-baskets/sol-core", "POST");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-action-version")).toBe("2.4");
    expect(response.headers.get("x-blockchain-ids")).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
  });

  it("a spelling variant cannot reach a removed path some other way", async () => {
    expect((await send("//api/trade/execute", "POST")).status).toBe(410);
    expect((await send("/api/TRADE/execute", "POST")).status).toBe(410);
  });

  it("goneResponse never caches", () => {
    expect(goneResponse("/api/markets").headers.get("cache-control")).toBe(
      "no-store",
    );
  });
});
