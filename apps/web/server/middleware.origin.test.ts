import fc from "fast-check";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPolicy } from "@/features/compliance/policy";
import { logger } from "./logger";
import { checkOrigin, ORIGIN_HEADER, originAccepted } from "./origin-lock";

/**
 * Phase H Step 2: the origin lock. In cloudflare mode every request without the edge's secret is
 * refused before any other gate, on every route type; the header never reaches a route; and the
 * secret is never logged. Plus: in cloudflare mode, the country comes only from CF-IPCountry.
 */
const { middleware } = await import("@/middleware");

const SECRET = "test-origin-secret-0123456789abcdefABCDEF";
const EDGE = {
  AROMA_PLATFORM: "selfhost",
  AROMA_DEPLOY_ENV: "development",
  AROMA_PROXY_MODE: "cloudflare",
  AROMA_ORIGIN_SECRET: SECRET,
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  for (const [k, v] of Object.entries(EDGE)) vi.stubEnv(k, v);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let ip = 0;
const call = (
  method: string,
  path: string,
  headers: Record<string, string> = {},
) =>
  middleware(
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "cf-connecting-ip": `198.51.100.${++ip % 250}`,
        "cf-ipcountry": "DE",
        ...(method === "GET" || method === "OPTIONS"
          ? {}
          : { "content-type": "application/json" }),
        ...headers,
      },
      ...(method === "GET" || method === "OPTIONS" ? {} : { body: "{}" }),
    }),
  );
const code = async (response: Response) =>
  response.headers.get("content-type")?.includes("json")
    ? ((await response.clone().json()) as { code?: string }).code
    : undefined;

/** Every route type the prompt names, plus the image optimizer and a preflight. */
const ROUTES: [string, string][] = [
  ["GET", "/"],
  ["GET", "/markets"],
  ["GET", "/stock/AAPLx"],
  ["GET", "/terms"],
  ["GET", "/api/v1/health"],
  ["GET", "/api/v1/health/live"],
  ["POST", "/api/v1/trade/quote"],
  ["POST", "/api/v1/trade/submit"],
  ["GET", "/api/v1/actions/baskets/sol-core"],
  ["POST", "/api/v1/actions/baskets/sol-core?amount=1"],
  ["POST", "/api/v1/actions/baskets/sol-core/confirm"],
  ["GET", "/actions.json"],
  ["POST", "/api/v1/notifications/deliver"],
  ["POST", "/api/v1/notifications/telegram"],
  ["POST", "/api/v1/revalidate"],
  ["POST", "/api/v1/faucet"],
  ["OPTIONS", "/api/v1/trade/quote"],
  ["GET", "/_next/image?url=%2Ficon.svg&w=64&q=75"],
  ["GET", "/api/v1/removed-prototype-route"],
];

describe("origin lock (cloudflare mode)", () => {
  it.each(ROUTES)(
    "%s %s without the secret: 403 ORIGIN_REFUSED",
    async (method, path) => {
      const response = await call(method, path);
      expect(response.status).toBe(403);
      expect(await code(response)).toBe("ORIGIN_REFUSED");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it.each(ROUTES)(
    "%s %s with a wrong secret: 403 ORIGIN_REFUSED",
    async (method, path) => {
      for (const wrong of [
        "x",
        SECRET.slice(0, -1),
        `${SECRET}x`,
        SECRET.toUpperCase(),
        ` ${"a".repeat(64)} `,
      ]) {
        const response = await call(method, path, { [ORIGIN_HEADER]: wrong });
        expect(response.status).toBe(403);
        expect(await code(response)).toBe("ORIGIN_REFUSED");
      }
    },
  );

  it.each(ROUTES)(
    "%s %s with the secret: past the lock, header stripped",
    async (method, path) => {
      const response = await call(method, path, { [ORIGIN_HEADER]: SECRET });
      expect(await code(response)).not.toBe("ORIGIN_REFUSED");
      // Next forwards overridden request headers as x-middleware-request-<name>.
      const forwarded =
        response.headers.get("x-middleware-override-headers") ?? "";
      expect(forwarded.split(",")).not.toContain(ORIGIN_HEADER);
      expect(
        response.headers.get(`x-middleware-request-${ORIGIN_HEADER}`),
      ).toBeNull();
      // Never echoed in a response header either.
      for (const [, value] of response.headers)
        expect(value).not.toContain(SECRET);
    },
  );

  it("refuses everything when the secret is not configured (fail closed)", async () => {
    vi.stubEnv("AROMA_ORIGIN_SECRET", "");
    const response = await call("GET", "/markets", { [ORIGIN_HEADER]: SECRET });
    expect(response.status).toBe(403);
    vi.stubEnv("AROMA_ORIGIN_SECRET", "short");
    expect(
      (await call("GET", "/markets", { [ORIGIN_HEADER]: "short" })).status,
    ).toBe(403);
  });

  it("logs the path and reason only, never the sent value or the secret", async () => {
    const warn = vi.spyOn(logger, "warn");
    await call("POST", "/api/v1/trade/quote", {
      [ORIGIN_HEADER]: "guess-0123456789-abcdef-guess",
    });
    await call("GET", "/markets");
    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalled();
    expect(logged).toContain("mismatch");
    expect(logged).toContain("missing");
    expect(logged).not.toContain("guess-0123456789-abcdef-guess");
    expect(logged).not.toContain(SECRET);
  });

  it("does not apply outside cloudflare mode (Vercel and none are unchanged)", async () => {
    vi.stubEnv("AROMA_PROXY_MODE", "");
    expect((await call("GET", "/markets")).status).not.toBe(403);
    expect(
      originAccepted(new Headers(), { VERCEL: "1", VERCEL_ENV: "production" }),
    ).toBe(true);
    expect(checkOrigin(new Headers({ [ORIGIN_HEADER]: SECRET }), EDGE)).toBe(
      "ok",
    );
  });
});

const TRADING: [string, string][] = [
  ["POST", "/api/v1/trade/quote"],
  ["POST", "/api/v1/trade/submit"],
  ["POST", "/api/v1/actions/baskets/sol-core?amount=1"],
  ["POST", "/api/v1/plans/prepare-create"],
  ["POST", "/api/v1/faucet"],
];
const HEADER_NAMES = [
  ORIGIN_HEADER,
  "x-forwarded-for",
  "x-real-ip",
  "true-client-ip",
  "x-forwarded-host",
  "x-forwarded-proto",
  "cf-connecting-ip",
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cf-visitor",
  "host",
  "origin",
  "authorization",
  "cookie",
];
const headerValue = fc.string({ minLength: 0, maxLength: 80 }).filter(
  // A value a Headers object accepts (no CR/LF/NUL), and never the real secret.
  (v) => !/[\r\n\0]/.test(v) && v.trim() !== SECRET,
);

describe("property: the origin lock and the country gate", () => {
  it("for any header set without the right secret, no trading entry point gets past middleware", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TRADING),
        fc.dictionary(fc.constantFrom(...HEADER_NAMES), headerValue, {
          maxKeys: 8,
        }),
        async ([method, path], headers) => {
          let response: Response;
          try {
            response = await call(method, path, headers);
          } catch {
            return; // a header set Next itself rejects never reaches a route either
          }
          expect(response.status).toBe(403);
          expect(await code(response)).toBe("ORIGIN_REFUSED");
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it("for any CF-IPCountry outside the allowed policy, trading is refused (even with the secret)", async () => {
    const policy = loadPolicy({});
    const allowedLooking = /^[A-Z]{2}$/;
    const outside = fc.oneof(
      fc.constantFrom(...policy.restrictedCountries),
      fc.constantFrom("XX", "T1", "", " ", "us", "u s", "USA", "1", "--"),
      fc
        .string({ minLength: 0, maxLength: 6 })
        .filter(
          (v) =>
            !/[\r\n\0]/.test(v) && !allowedLooking.test(v.trim().toUpperCase()),
        ),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TRADING),
        outside,
        async ([method, path], country) => {
          const response = await call(method, path, {
            [ORIGIN_HEADER]: SECRET,
            "cf-ipcountry": country,
            // A forged Vercel header must not rescue it.
            "x-vercel-ip-country": "DE",
          });
          expect(response.status).toBe(451);
          expect(await code(response)).toBe("JURISDICTION_RESTRICTED");
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
