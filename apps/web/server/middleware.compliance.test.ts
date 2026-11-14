import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M9 compliance gate at the edge: middleware geo-blocks every trading POST (stock, basket and
 * creator basket quotes and submits, the Action POST that builds a transaction, devnet plan
 * creation and the faucet) from the TRUSTED platform country header, failing closed when it is
 * missing or untrusted.
 */
const { middleware } = await import("@/middleware");

beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
afterEach(() => vi.unstubAllEnvs());

let ip = 0;
const post = (path: string, headers: Record<string, string> = {}) =>
  middleware(
    new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A fresh client IP per request keeps these tests out of the rate limiter's way.
        "x-real-ip": `198.51.100.${++ip % 250}`,
        ...headers,
      },
      body: "{}",
    }),
  );
const country = (code: string) => ({ "x-vercel-ip-country": code });

const TRADE_PATHS = [
  "/api/v1/trade/quote",
  "/api/v1/trade/submit",
  "/api/v1/actions/baskets/sol-core?amount=1",
  "/api/v1/actions/baskets/8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20?amount=1",
];

describe("geo gate in middleware", () => {
  beforeEach(() => vi.stubEnv("AROMA_TRUST_PROXY", "true"));

  it.each(TRADE_PATHS)(
    "a restricted country is refused on POST %s",
    async (path) => {
      const response = await post(path, country("US"));
      expect(response.status).toBe(451);
      expect(await response.json()).toEqual({
        code: "JURISDICTION_RESTRICTED",
        message: expect.stringMatching(/not available in your location/),
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each(TRADE_PATHS)("an allowed country passes POST %s", async (path) => {
    expect((await post(path, country("DE"))).status).toBe(200);
  });

  it.each([
    "//api/v1/trade/quote",
    "/api/v1//trade/submit",
    "/api/v1/trade/%71uote",
    "/api/v1/x/../trade/quote",
  ])(
    "a path spelling (%s) cannot skip the geo gate (found in Phase A)",
    async (path) => {
      const response = await post(path, country("US"));
      expect(response.status).toBe(451);
      expect((await response.json()).code).toBe("JURISDICTION_RESTRICTED");
    },
  );

  it("a missing country fails closed on trade routes", async () => {
    const response = await post("/api/v1/trade/quote");
    expect(response.status).toBe(451);
    expect((await response.json()).message).toMatch(/could not be confirmed/);
  });

  it("missing-country behaviour is configurable", async () => {
    vi.stubEnv("AROMA_COMPLIANCE_MISSING_COUNTRY", "allow");
    expect((await post("/api/v1/trade/quote")).status).toBe(200);
    expect((await post("/api/v1/trade/quote", country("US"))).status).toBe(451);
  });

  it("the Action POST refusal keeps the Actions CORS headers and a readable message", async () => {
    const response = await post("/api/v1/actions/baskets/sol-core?amount=1", {
      ...country("US"),
      origin: "https://dial.to",
    });
    expect(response.status).toBe(451);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-action-version")).toBe("2.4");
    expect((await response.json()).message).toBeTruthy();
  });

  it("the Action confirm callback is never blocked (it records a receipt for a sent transaction)", async () => {
    expect(
      (await post("/api/v1/actions/baskets/sol-core/confirm", country("US")))
        .status,
    ).toBe(200);
  });

  it("devnet plan creation and the faucet follow the devnet rule; closing a plan never blocks", async () => {
    expect(
      (await post("/api/v1/plans/prepare-create", country("US"))).status,
    ).toBe(451);
    expect((await post("/api/v1/faucet", country("US"))).status).toBe(451);
    expect((await post("/api/v1/plans/submit", country("US"))).status).toBe(
      200,
    );
    vi.stubEnv("AROMA_COMPLIANCE_DEVNET", "allow");
    expect(
      (await post("/api/v1/plans/prepare-create", country("US"))).status,
    ).toBe(200);
  });

  it("the removed prototype trade paths are gone (410), whatever the country (M9)", async () => {
    const response = await post("/api/trade/execute", country("US"));
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "GONE" });
  });

  it("an invalid policy fails closed on gated paths", async () => {
    vi.stubEnv("AROMA_TERMS_VERSION", "unknown-version");
    expect((await post("/api/v1/trade/quote", country("DE"))).status).toBe(451);
  });

  it("reads and terms acceptance are not geo-blocked", async () => {
    const get = await middleware(
      new NextRequest("http://localhost:3000/api/v1/actions/baskets/sol-core", {
        headers: country("US"),
      }),
    );
    expect(get.status).toBe(200);
    expect(
      (await post("/api/v1/compliance/terms/accept", country("US"))).status,
    ).toBe(200);
  });
});

describe("untrusted proxy", () => {
  it("a spoofed country header is ignored without a trusted proxy (fails closed)", async () => {
    const response = await post("/api/v1/trade/quote", country("DE"));
    expect(response.status).toBe(451);
    expect((await response.json()).message).toMatch(/could not be confirmed/);
  });
});

describe("browse rule", () => {
  beforeEach(() => vi.stubEnv("AROMA_TRUST_PROXY", "true"));
  const page = (path: string, code: string) =>
    middleware(
      new NextRequest(`http://localhost:3000${path}`, {
        headers: country(code),
      }),
    );

  it("browse-only by default: a restricted visitor sees v1 pages", async () => {
    const response = await page("/markets", "US");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("browse=block rewrites pages (not the legal pages, APIs or files) to the notice page", async () => {
    vi.stubEnv("AROMA_COMPLIANCE_BROWSE", "block");
    for (const path of ["/", "/markets", "/stock/TSLAx"]) {
      const blocked = await page(path, "US");
      expect(blocked.headers.get("x-middleware-rewrite")).toMatch(
        /\/restricted$/,
      );
    }
    for (const path of [
      "/privacy",
      "/restricted",
      "/sitemap.xml",
      "/actions.json",
    ])
      expect(
        (await page(path, "US")).headers.get("x-middleware-rewrite"),
      ).toBeNull();
    expect(
      (await page("/terms", "US")).headers.get("x-middleware-rewrite"),
    ).toBeNull();
    expect(
      (await page("/markets", "DE")).headers.get("x-middleware-rewrite"),
    ).toBeNull();
  });
});
