import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * middleware.ts (M4). The first block was PORTED from the prototype suites that loaded the old
 * synchronous middleware in a VM (tests/request-policy.test.mjs, tests/bundle-api.test.ts,
 * tests/basket-buy-actions.test.ts); since M9 it runs on v1 paths (the prototype APIs are gone).
 * The second block covers what M4 adds: nonce CSP on /, one HSTS header, split buckets.
 */
const { middleware } = await import("@/middleware");

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  // M9: these tests are not about the geo gate (server/middleware.compliance.test.ts is); with no
  // trusted country header the gate would fail closed, so it is opened for them.
  vi.stubEnv("AROMA_COMPLIANCE_MISSING_COUNTRY", "allow");
});
afterEach(() => vi.unstubAllEnvs());

const req = (
  url: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) => new NextRequest(url, init);

describe("request guards (ported from the prototype suites; v1 paths since M9)", () => {
  it("CORS allows configured browser origins and native requests, never wildcard origins", async () => {
    const response = await middleware(
      req("http://localhost:3000/api/v1/health", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:8081" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:8081",
    );
    expect(response.headers.get("access-control-expose-headers")).toMatch(
      /ETag/,
    );
    expect(
      (
        await middleware(
          req("http://localhost:3000/api/v1/health", {
            headers: { origin: "https://unknown.example" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await middleware(req("http://localhost:3000/api/v1/health"))).status,
    ).toBe(200);
  });

  it("HTTPS redirects only to the configured canonical host and ignores untrusted proxy headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AROMA_SITE_URL", "https://aroma.example");
    const response = await middleware(
      req("http://attacker.example/markets?q=a", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://aroma.example/markets?q=a",
    );
    expect(
      (await middleware(req("http://127.0.0.1:3000/api/v1/health"))).status,
    ).toBe(200);
  });

  it("write endpoints require JSON and limit declared payloads (32 KiB only for v1 submit)", async () => {
    expect(
      (
        await middleware(
          req("http://localhost:3000/api/v1/trade/quote", {
            method: "POST",
            body: "amount=1",
          }),
        )
      ).status,
    ).toBe(415);
    const post = (path: string, length: number) =>
      req(`http://localhost:3000${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(length),
        },
        body: "{}",
      });
    expect(
      (await middleware(post("/api/v1/trade/submit", 32_768))).status,
    ).not.toBe(413);
    expect(
      (await middleware(post("/api/v1/trade/submit", 32_769))).status,
    ).toBe(413);
    expect((await middleware(post("/api/v1/trade/quote", 16_385))).status).toBe(
      413,
    );
    expect(
      (
        await middleware(
          req("http://localhost:3000/api/v1/trade/quote", {
            method: "POST",
            headers: { "content-type": "application/jsonp" },
          }),
        )
      ).status,
    ).toBe(415);
  });

  it("trusted HTTPS termination accepts the public same-origin browser request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    const response = await middleware(
      req("http://aroma.example/api/v1/health", {
        headers: {
          origin: "https://aroma.example",
          "x-forwarded-proto": "https",
          "x-real-ip": "test",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://aroma.example",
    );
    const preflight = await middleware(
      req("http://aroma.example/api/v1/trade/quote", {
        method: "OPTIONS",
        headers: {
          origin: "https://aroma.example",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("strict-transport-security")).toMatch(
      /max-age/,
    );
  });

  it("invalid canonical URLs fail closed with { code, message }", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const url of ["https://", "https://user:password@aroma.example"]) {
      vi.stubEnv("AROMA_SITE_URL", url);
      const response = await middleware(
        req("http://aroma.example/api/v1/health"),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        code: "SERVICE_UNAVAILABLE",
        message: "This service is temporarily unavailable.",
      });
    }
  });

  it("v1 Action error and OPTIONS responses carry the mainnet Action headers", async () => {
    for (const method of ["OPTIONS", "POST"]) {
      const response = await middleware(
        req("http://localhost:3000/api/v1/actions/baskets/sol-chips", {
          method,
        }),
      );
      expect(response.status).toBe(method === "OPTIONS" ? 204 : 415);
      expect(response.headers.get("X-Blockchain-Ids")).toBe(
        "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      );
    }
  });
});

describe("M4 additions", () => {
  it("every route gets a per-request nonce CSP without 'unsafe-inline' scripts (M9)", async () => {
    const first = await middleware(req("http://localhost:3000/markets"));
    const second = await middleware(req("http://localhost:3000/markets"));
    const csp = first.headers.get("content-security-policy")!;
    expect(csp).toMatch(
      /script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'/,
    );
    expect(
      csp.split("; ").find((d) => d.startsWith("script-src")),
    ).not.toContain("unsafe-inline");
    expect(csp).toMatch(
      /connect-src 'self' https:\/\/api\.mainnet-beta\.solana\.com/,
    );
    expect(csp).not.toMatch(/connect-src[^;]* https: /);
    expect(second.headers.get("content-security-policy")).not.toBe(csp);
    for (const path of [
      "/",
      "/markets",
      "/api/v1/health",
      "/actions.json",
      "/nope",
    ])
      expect(
        (await middleware(req(`http://localhost:3000${path}`))).headers.get(
          "content-security-policy",
        ),
      ).toMatch(/'nonce-/);
  });

  it("the origin allowlist uses the client's Host (next start binds to localhost)", async () => {
    const response = await middleware(
      req("http://localhost:3200/api/v1/trade/quote", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3200",
          origin: "http://127.0.0.1:3200",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("the loopback check uses the client's Host, not the server bind address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AROMA_SITE_URL", "https://www.example.com");
    vi.stubEnv("VERCEL", "1");
    const viaProxy = await middleware(
      req("http://127.0.0.1:3300/", {
        headers: { host: "www.example.com", "x-forwarded-proto": "https" },
      }),
    );
    expect(viaProxy.headers.get("strict-transport-security")).toMatch(
      /preload/,
    );
  });

  it("one HSTS header with includeSubDomains and preload over HTTPS in production, none on loopback HTTP", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AROMA_SITE_URL", "https://aroma.example");
    vi.stubEnv("VERCEL", "1");
    const https = await middleware(
      req("http://aroma.example/v1", {
        headers: { "x-forwarded-proto": "https" },
      }),
    );
    expect(https.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(
      (await middleware(req("http://localhost:3000/"))).headers.get(
        "strict-transport-security",
      ),
    ).toBeNull();
  });

  it("no HSTS on a Vercel preview or a development run, even over HTTPS (M9: production only)", async () => {
    vi.stubEnv("VERCEL", "1");
    const https = () =>
      middleware(
        req("http://aroma-git-x.vercel.app/", {
          headers: { "x-forwarded-proto": "https" },
        }),
      );
    expect((await https()).headers.get("strict-transport-security")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("AROMA_SITE_URL", "https://aroma-git-x.vercel.app");
    expect((await https()).headers.get("strict-transport-security")).toBeNull();
  });

  it("v1 rejections are { code, message }; the trade bucket answers 429 before the write bucket", async () => {
    vi.stubEnv("VERCEL", "1");
    const quote = () =>
      middleware(
        req("http://localhost:3000/api/v1/trade/quote", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-real-ip": "198.51.100.7",
          },
          body: "{}",
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await quote()).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    const limited = await quote();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await limited.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait and try again.",
    });
    // A different client is unaffected.
    const other = await middleware(
      req("http://localhost:3000/api/v1/trade/quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-real-ip": "198.51.100.8",
        },
        body: "{}",
      }),
    );
    expect(other.status).toBe(200);
  });
});
