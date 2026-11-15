import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M5b B4: middleware treats /api/v1/actions/* as Solana Action paths, like the prototype's
 * /api/actions/*: any origin may call them (they only prepare owner-signed transactions), with
 * the Actions CORS and chain headers, and POST is limited by the trade bucket.
 */
const { middleware } = await import("@/middleware");

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  // M9: these tests are not about the geo gate (server/middleware.compliance.test.ts is); with no
  // trusted country header the gate would fail closed, so it is opened for them.
  vi.stubEnv("OVELO_COMPLIANCE_MISSING_COUNTRY", "allow");
});
afterEach(() => vi.unstubAllEnvs());

const ID = "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20";
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const req = (
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) => new NextRequest(`http://localhost:3000${path}`, init);

describe("v1 Action paths in middleware", () => {
  it.each(["GET", "OPTIONS"])(
    "%s from any site (a Blink client) passes with Action headers",
    async (method) => {
      const response = await middleware(
        req(`/api/v1/actions/baskets/${ID}`, {
          method,
          headers: { origin: "https://dial.to" },
        }),
      );
      expect(response.status).toBe(method === "OPTIONS" ? 204 : 200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("x-blockchain-ids")).toBe(MAINNET);
      expect(response.headers.get("x-action-version")).toBe("2.4");
      expect(response.headers.get("access-control-allow-methods")).toMatch(
        /POST/,
      );
    },
  );

  it("POST and the confirm callback from another site are not refused for origin", async () => {
    for (const path of [
      `/api/v1/actions/baskets/${ID}?amount=1`,
      `/api/v1/actions/baskets/${ID}/confirm`,
    ]) {
      const response = await middleware(
        req(path, {
          method: "POST",
          headers: {
            origin: "https://x.com",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("POST is in the trade bucket (10/min), JSON-only, with { code, message } rejections", async () => {
    vi.stubEnv("VERCEL", "1");
    const post = (contentType = "application/json") =>
      middleware(
        req(`/api/v1/actions/baskets/${ID}?amount=1`, {
          method: "POST",
          headers: { "content-type": contentType, "x-real-ip": "203.0.113.77" },
          body: "{}",
        }),
      );
    expect((await post("text/plain")).status).toBe(415);
    for (let i = 0; i < 9; i++) expect((await post()).status).toBe(200);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      code: "RATE_LIMITED",
      message: expect.any(String),
    });
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("the removed prototype Action paths answer 410 GONE with mainnet Action headers (M9)", async () => {
    for (const path of [
      "/api/actions/recurring/x",
      "/api/actions/buy-baskets/sol-core",
    ]) {
      const gone = await middleware(
        req(path, { headers: { origin: "https://dial.to" } }),
      );
      expect(gone.status).toBe(410);
      expect(gone.headers.get("x-blockchain-ids")).toBe(MAINNET);
      expect(gone.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("credentialed v1 APIs still enforce the origin allowlist", async () => {
    const response = await middleware(
      req("/api/v1/trade/quote", {
        method: "POST",
        headers: {
          origin: "https://dial.to",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });
});
