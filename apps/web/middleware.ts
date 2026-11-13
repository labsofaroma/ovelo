import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, generateNonce, HSTS, isV1Path } from "./server/csp";
import { testSwitchesAllowed } from "./server/env.schema";
import { ERROR_CODES, type ErrorCode } from "./server/errors";
import { createRateLimiter, type RateLimiter } from "./server/ratelimit";
import { getRedis } from "./server/redis";
import {
  allowedOrigin,
  bucketFor,
  clientIp,
  isLoopback,
  LIMITS,
  maxBodyBytes,
  requestProtocol,
  type Bucket,
} from "./server/request-guard";

/**
 * Middleware (M4 B8; closes AUDIT H-4 and H-6 for v1, and the L-2 HSTS item).
 * - HTTPS: redirect to AROMA_SITE_URL in production, then ONE HSTS header with includeSubDomains
 *   and preload.
 * - /v1/* and /api/v1/*: a per-request nonce CSP (no 'unsafe-inline' scripts), the nonce passed to
 *   Next via the request headers.
 * - /api/*: origin allowlist, JSON-only mutations, body cap, and Upstash rate limits split into
 *   read, write and trade buckets (a bounded local fallback evicts the oldest key and never
 *   locks everyone out). The prototype keeps its `{ error }` bodies; v1 gets `{ code, message }`.
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
  };
  return limiters[bucket];
}

function reject(
  v1: boolean,
  action: boolean,
  code: ErrorCode,
  headers: Record<string, string> = {},
): NextResponse {
  const message = ERROR_CODES[code].message;
  return NextResponse.json(
    v1 ? { code, message } : action ? { message } : { error: message },
    {
      status: ERROR_CODES[code].status,
      headers: { "Cache-Control": "no-store", ...headers },
    },
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
  const local = isLoopback(request.nextUrl.hostname);

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
      return NextResponse.json(
        {
          error:
            "HTTPS is required. Configure the public site URL and trusted reverse proxy.",
        },
        { status: 503 },
      );
    }
  }

  const v1 = isV1Path(pathname);
  const api = pathname.startsWith("/api/");
  const action =
    pathname.startsWith("/api/actions/") || pathname === "/actions.json";

  // Nonce CSP for v1 pages and APIs; Next reads the nonce from the request's CSP header.
  const nonce = v1 ? generateNonce() : null;
  const csp = nonce ? buildCsp({ nonce, env, development }) : null;
  const requestHeaders = new Headers(request.headers);
  if (nonce && csp) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (api || action) {
    const origin = request.headers.get("origin");
    const effectiveOrigin = `${protocol}://${request.nextUrl.host}`;
    if (
      !action &&
      !allowedOrigin(
        origin,
        effectiveOrigin,
        env.AROMA_ALLOWED_ORIGINS ?? "",
        development,
      )
    )
      response = reject(v1, action, "ORIGIN_FORBIDDEN");
    else if (request.method === "OPTIONS")
      response = new NextResponse(null, { status: 204 });
    else {
      const mutation = !["GET", "HEAD"].includes(request.method);
      const decision = await limiter(bucketFor(pathname, request.method)).check(
        clientIp(request.headers, env),
      );
      if (!decision.allowed)
        response = reject(v1, action, "RATE_LIMITED", {
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
        response = reject(v1, action, "UNSUPPORTED_MEDIA_TYPE");
      else if (
        mutation &&
        Number(request.headers.get("content-length") ?? 0) >
          maxBodyBytes(pathname)
      )
        response = reject(v1, action, "PAYLOAD_TOO_LARGE");
    }
    if (action) {
      // Public Actions only prepare owner-signed transactions. Credentialed APIs keep the allowlist.
      response.headers.set("Access-Control-Allow-Origin", "*");
      response.headers.set(
        "X-Blockchain-Ids",
        pathname.startsWith("/api/actions/buy-baskets/")
          ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
          : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
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

  if (csp) response.headers.set("Content-Security-Policy", csp);
  if (!local && protocol === "https")
    response.headers.set("Strict-Transport-Security", HSTS);
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
