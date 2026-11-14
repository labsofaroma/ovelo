import { NextResponse, type NextRequest } from "next/server";
import {
  browseBlocked,
  edgeRefusal,
  RESTRICTED_PAGE,
} from "./features/compliance/edge";
import { betaDeps } from "./features/beta/server/deps";
import { betaEdgeRefusal } from "./features/beta/server/edge";
import { normalizePath } from "./features/beta/paths";
import { buildCsp, generateNonce, HSTS } from "./server/csp";
import { testSwitchesAllowed } from "./server/env.schema";
import { ERROR_CODES, type ErrorCode } from "./server/errors";
import { goneResponse, isGonePath } from "./server/gone";
import { createRateLimiter, type RateLimiter } from "./server/ratelimit";
import { getRedis } from "./server/redis";
import {
  allowedOrigin,
  bucketFor,
  clientIp,
  isLoopback,
  LIMITS,
  maxBodyBytes,
  requestHost,
  requestHostname,
  requestProtocol,
  type Bucket,
} from "./server/request-guard";

/**
 * Middleware (M4 B8; closes AUDIT H-4 and H-6 for v1, and the L-2 HSTS item).
 * - HTTPS: redirect to AROMA_SITE_URL in production, then ONE HSTS header with includeSubDomains
 *   and preload.
 * - Every route: a per-request nonce CSP (no 'unsafe-inline' scripts), the nonce passed to
 *   Next via the request headers.
 * - /api/*: origin allowlist, JSON-only mutations, body cap, and Upstash rate limits split into
 *   read, write, trade and creator buckets (a bounded local fallback evicts the oldest key and never
 *   locks everyone out). Every refusal is `{ code, message }`.
 * - M9: the removed prototype APIs answer 410 GONE (server/gone.ts) before any other guard.
 * Runs on the Node.js runtime so it can use the server modules (pino, Upstash).
 */

const required =
  process.env.AROMA_V1_ENABLED?.trim() === "true" &&
  !testSwitchesAllowed(process.env);
let limiters: Record<Bucket, RateLimiter> | null = null;
function limiter(bucket: Bucket): RateLimiter {
  limiters ??= {
    read: createRateLimiter({
      name: "api:read",
      ...LIMITS.read,
      redis: getRedis(),
      required,
    }),
    write: createRateLimiter({
      name: "api:write",
      ...LIMITS.write,
      redis: getRedis(),
      required,
    }),
    trade: createRateLimiter({
      name: "api:trade",
      ...LIMITS.trade,
      redis: getRedis(),
      required,
    }),
    creator: createRateLimiter({
      name: "api:creator",
      ...LIMITS.creator,
      redis: getRedis(),
      required,
    }),
    faucet: createRateLimiter({
      name: "api:faucet",
      ...LIMITS.faucet,
      redis: getRedis(),
      required,
    }),
  };
  return limiters[bucket];
}

function reject(
  code: ErrorCode,
  headers: Record<string, string> = {},
): NextResponse {
  const { message, status } = ERROR_CODES[code];
  return NextResponse.json(
    { code, message },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const env = process.env;
  const development = env.NODE_ENV !== "production";
  const protocol = requestProtocol(
    request.headers,
    request.nextUrl.protocol,
    env,
  );
  // The host the client used (nextUrl can carry the server's own bind address under next start).
  const local = isLoopback(
    requestHostname(request.headers, request.nextUrl.hostname, env),
  );

  if (!development && !local && protocol !== "https") {
    const target = env.AROMA_SITE_URL;
    try {
      const destination = new URL(target ?? "");
      if (
        destination.protocol !== "https:" ||
        destination.username ||
        destination.password
      )
        throw new Error("invalid site url");
      destination.pathname = pathname;
      destination.search = request.nextUrl.search;
      return NextResponse.redirect(destination, 308);
    } catch {
      // The public site URL is not configured: fail closed.
      return reject("SERVICE_UNAVAILABLE");
    }
  }

  // Phase A: the API guards (origin, limits, geo, beta) match a NORMALISED spelling too, so a
  // variant such as `//api/v1/trade/quote` or `/api/v1/trade/%71uote` cannot skip them.
  const gatePath = normalizePath(pathname);
  // M9: the removed prototype APIs are gone for good (410), whatever else the request carries.
  if (isGonePath(gatePath)) {
    const gone = goneResponse(gatePath);
    if (!local && protocol === "https")
      gone.headers.set("Strict-Transport-Security", HSTS);
    return gone;
  }
  const api = pathname.startsWith("/api/") || gatePath.startsWith("/api/");
  // Solana Actions (M5b): /api/v1/actions/* and the actions.json rules file.
  const action =
    gatePath.startsWith("/api/v1/actions/") || pathname === "/actions.json";

  // Nonce CSP on every route (M9: the prototype's policy is gone); Next reads the nonce from the
  // request's CSP header.
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, env, development });
  const requestHeaders = new Headers(request.headers);
  {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  // --- M9 compliance gate (additive): browse-blocked visitors see the notice page. ---
  if (browseBlocked(pathname, request.headers, env))
    response = NextResponse.rewrite(new URL(RESTRICTED_PAGE, request.url), {
      request: { headers: requestHeaders },
    });
  // --- end M9 compliance gate ---

  if (api || action) {
    const origin = request.headers.get("origin");
    // The origin the browser used: Host (x-forwarded-host only behind a trusted proxy), not
    // nextUrl, which can carry the server's bind address under next start.
    const effectiveOrigin = `${protocol}://${requestHost(request.headers, request.nextUrl.host, env)}`;
    if (
      !action &&
      !allowedOrigin(
        origin,
        effectiveOrigin,
        env.AROMA_ALLOWED_ORIGINS ?? "",
        development,
      )
    )
      response = reject("ORIGIN_FORBIDDEN");
    else if (request.method === "OPTIONS")
      response = new NextResponse(null, { status: 204 });
    else {
      const mutation = !["GET", "HEAD"].includes(request.method);
      const decision = await limiter(bucketFor(pathname, request.method)).check(
        clientIp(request.headers, env),
      );
      if (!decision.allowed)
        response = reject("RATE_LIMITED", {
          "Retry-After": String(decision.retryAfterSeconds),
        });
      else if (
        mutation &&
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        response = reject("UNSUPPORTED_MEDIA_TYPE");
      else if (
        mutation &&
        Number(request.headers.get("content-length") ?? 0) >
          maxBodyBytes(pathname)
      )
        response = reject("PAYLOAD_TOO_LARGE");
      // --- M9 compliance gate (additive): geo-blocking on every trading entry point. ---
      else {
        const refusal = edgeRefusal(
          gatePath,
          request.method,
          request.headers,
          env,
        );
        // --- Phase A private beta (W2, additive): location first, then beta access. ---
        const beta = refusal
          ? null
          : await betaEdgeRefusal(
              request,
              pathname,
              betaDeps(),
              maxBodyBytes(pathname),
            );
        const refused = refusal ?? beta;
        if (refused)
          response = NextResponse.json(refused.body, {
            status: refused.status,
            headers: { "Cache-Control": "no-store" },
          });
      }
      // --- end M9 compliance gate ---
    }
    if (action) {
      // Public Actions only prepare owner-signed transactions. Credentialed APIs keep the allowlist.
      response.headers.set("Access-Control-Allow-Origin", "*");
      // v1 Actions are mainnet spot purchases only.
      response.headers.set(
        "X-Blockchain-Ids",
        "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      );
      response.headers.set("X-Action-Version", "2.4");
    } else if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.append("Vary", "Origin");
    }
    response.headers.set(
      "Access-Control-Allow-Methods",
      action ? "GET,POST,PUT,OPTIONS" : "GET, POST, OPTIONS",
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, If-None-Match, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
    );
    response.headers.set(
      "Access-Control-Expose-Headers",
      "ETag, Retry-After, X-Blockchain-Ids, X-Action-Version",
    );
    if (request.method === "OPTIONS")
      response.headers.set("Access-Control-Max-Age", "600");
  }

  response.headers.set("Content-Security-Policy", csp);
  if (!local && protocol === "https")
    response.headers.set("Strict-Transport-Security", HSTS);
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
