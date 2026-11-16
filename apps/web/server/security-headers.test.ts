import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubBaseEnv } from "@/server/test/base-env";

/**
 * M9 Step 7: the security headers on a sample of every route type. Middleware sets the per-request
 * nonce CSP and HSTS; next.config.mjs sets the static headers on every path.
 */
const { middleware } = await import("@/middleware");
const nextConfig = (await import("../next.config.mjs")).default as {
  headers: () => Promise<
    { source: string; headers: { key: string; value: string }[] }[]
  >;
};

const SAMPLES = {
  page: "/",
  "dynamic page": "/stock/TSLAx",
  "versioned API": "/api/v1/health",
  "Solana Action": "/api/v1/actions/baskets/sol-core",
  "actions.json": "/actions.json",
  "removed prototype API (410)": "/api/trade/order",
  "unknown URL (404)": "/no-such-page",
} as const;

beforeEach(() => {
  stubBaseEnv();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("OVELO_SITE_URL", "https://ovelo.example");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_URL", "https://rpc.ovelo.example/k");
});
afterEach(() => vi.unstubAllEnvs());

const get = (path: string) =>
  middleware(
    new NextRequest(`http://ovelo.example${path}`, {
      headers: { "x-forwarded-proto": "https", "x-vercel-ip-country": "DE" },
    }),
  );

describe.each(Object.entries(SAMPLES))("%s", (_type, path) => {
  it("nonce CSP: no inline scripts, no framing, explicit connect-src", async () => {
    const csp = (await get(path)).headers.get("content-security-policy") ?? "";
    const directive = (name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("script-src")).toMatch(
      /^script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'$/,
    );
    expect(directive("script-src")).not.toContain("unsafe");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    const connect = directive("connect-src").split(" ").slice(1);
    for (const source of connect)
      expect(source).not.toMatch(/^(https?|wss?):$/);
    expect(connect).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://rpc.ovelo.example",
        "https://api.jup.ag",
        "https://hermes.pyth.network",
        "https://challenges.cloudflare.com",
      ]),
    );
  });

  it("img-src is exactly 'self', data:, blob:, the four logo hosts (image-hosts.mjs) and WalletConnect's wallet logos", async () => {
    const csp = (await get(path)).headers.get("content-security-policy") ?? "";
    // Spelled out here, not read from IMAGE_HOSTS, so a host added to the list must be added here.
    expect(csp.split("; ").find((d) => d.startsWith("img-src "))).toBe(
      "img-src 'self' data: blob: https://xstocks-metadata.backed.fi https://prestocks.com https://backpack.exchange https://static.datapi.jup.ag https://api.web3modal.org",
    );
  });

  it("HSTS with includeSubDomains and preload (production over HTTPS)", async () => {
    expect((await get(path)).headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });
});

describe("static headers on every path (next.config.mjs)", () => {
  it("nosniff, referrer policy, permissions policy and no framing", async () => {
    const rules = await nextConfig.headers();
    const all = rules.find((rule) => rule.source === "/:path*");
    const headers = Object.fromEntries(
      (all?.headers ?? []).map((h) => [h.key, h.value]),
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    for (const feature of ["camera", "microphone", "geolocation", "payment"])
      expect(headers["Permissions-Policy"]).toContain(`${feature}=()`);
    // No other rule (the prototype's CSP is gone): middleware owns the CSP.
    expect(rules).toHaveLength(1);
  });
});
