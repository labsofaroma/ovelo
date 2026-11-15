import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * middleware.ts for the creator API (M5b Part A). Handlers no longer check Origin or rate limit
 * themselves (they used to, with a request.url fallback and one shared "local" bucket); M4's
 * middleware owns both for every /api/* route.
 */
const { middleware } = await import("@/middleware");

beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
afterEach(() => vi.unstubAllEnvs());

const post = (
  url: string,
  headers: Record<string, string>,
  body = "{}",
  method = "POST",
) =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body,
  });

const CREATOR_MUTATIONS = [
  ["POST", "/api/v1/creators/challenge"],
  ["POST", "/api/v1/creators/invites/redeem"],
  ["POST", "/api/v1/creators/baskets"],
  ["DELETE", "/api/v1/creators/baskets/1f0e6a7c-3c2b-4f53-9d55-0d7c8f0c2a11"],
] as const;

describe("creator routes: origin (A2)", () => {
  it.each(CREATOR_MUTATIONS)(
    "%s %s from another site is refused before the handler",
    async (method, path) => {
      const response = await middleware(
        post(
          `http://localhost:3000${path}`,
          { origin: "https://evil.example" },
          "{}",
          method,
        ),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: "ORIGIN_FORBIDDEN",
        message: expect.any(String),
      });
    },
  );

  it("a same-site publish under next start is accepted (bind address localhost, public Host via proxy)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("AROMA_SITE_URL", "https://aroma.example");
    const response = await middleware(
      post("http://localhost:3000/api/v1/creators/baskets", {
        host: "localhost:3000",
        "x-forwarded-host": "aroma.example",
        "x-forwarded-proto": "https",
        origin: "https://aroma.example",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://aroma.example",
    );
  });

  it("a same-site publish to a local next start on 127.0.0.1 is accepted", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await middleware(
      post("http://localhost:3200/api/v1/creators/challenge", {
        host: "127.0.0.1:3200",
        origin: "http://127.0.0.1:3200",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("a request without Origin (a native client) reaches the handler, which still needs a signature", async () => {
    const response = await middleware(
      post("http://localhost:3000/api/v1/creators/invites/redeem", {}),
    );
    expect(response.status).toBe(200);
  });
});

describe("creator routes: rate limits in middleware (A3)", () => {
  const ip = (n: number) => `198.51.100.${n}`;
  const challenge = (address: string) =>
    middleware(
      post("http://localhost:3000/api/v1/creators/challenge", {
        "x-real-ip": address,
      }),
    );

  it("challenge issuance is limited per client with Retry-After, without blocking other clients or writes", async () => {
    vi.stubEnv("VERCEL", "1");
    for (let i = 0; i < 10; i++)
      expect((await challenge(ip(1))).status).toBe(200);
    const limited = await challenge(ip(1));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({
      code: "RATE_LIMITED",
      message: expect.any(String),
    });
    // Another creator is not blocked by the first one's bucket.
    expect((await challenge(ip(2))).status).toBe(200);
    // Publishing (write bucket) is a separate budget for the same client.
    const publish = await middleware(
      post("http://localhost:3000/api/v1/creators/baskets", {
        "x-real-ip": ip(1),
      }),
    );
    expect(publish.status).toBe(200);
  });

  it("invite redemption shares the creator bucket (code guessing is bounded)", async () => {
    vi.stubEnv("VERCEL", "1");
    const redeem = () =>
      middleware(
        post("http://localhost:3000/api/v1/creators/invites/redeem", {
          "x-real-ip": ip(3),
        }),
      );
    for (let i = 0; i < 10; i++) expect((await redeem()).status).toBe(200);
    expect((await redeem()).status).toBe(429);
  });
});

describe("creator routes: JSON and body size (A4)", () => {
  /** The largest publish a client can send: 20 allocations, escaped description, signature. */
  const maximal = JSON.stringify({
    action: "publish",
    wallet: "11111111111111111111111111111111111111111111",
    basketId: "1f0e6a7c-3c2b-4f53-9d55-0d7c8f0c2a11",
    nonce: "n".repeat(32),
    signature: "s".repeat(88),
    basket: {
      name: "\u0001".repeat(50),
      ticker: "MAXIMAL",
      description: "\u0001".repeat(500),
      allocations: Array.from({ length: 20 }, (_, i) => ({
        mint: `${String(i).padStart(2, "1")}${"X".repeat(42)}`,
        weightBps: 500,
      })),
    },
  });

  it.each(CREATOR_MUTATIONS)(
    "%s %s without Content-Type: application/json is 415",
    async (method, path) => {
      const response = await middleware(
        new NextRequest(`http://localhost:3000${path}`, {
          method,
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      );
      expect(response.status).toBe(415);
      expect((await response.json()).code).toBe("UNSUPPORTED_MEDIA_TYPE");
    },
  );

  it.each(CREATOR_MUTATIONS)(
    "%s %s with a maximal JSON payload passes the body cap",
    async (method, path) => {
      const bytes = new TextEncoder().encode(maximal).length;
      expect(bytes).toBeLessThan(8_192);
      const response = await middleware(
        post(
          `http://localhost:3000${path}`,
          {
            "content-length": String(bytes),
            "x-real-ip": `192.0.2.${CREATOR_MUTATIONS.findIndex((m) => m[1] === path) + 1}`,
          },
          maximal,
          method,
        ),
      );
      expect(response.status).toBe(200);
    },
  );

  it("a declared body over 16 KiB is 413 before the handler reads it", async () => {
    const response = await middleware(
      post("http://localhost:3000/api/v1/creators/baskets", {
        "content-length": String(16_385),
      }),
    );
    expect(response.status).toBe(413);
  });
});
