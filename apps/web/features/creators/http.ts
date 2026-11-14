import "server-only";
import type { Redis } from "@upstash/redis";
import { getMarkets } from "@/features/markets/server";
import type { ChallengeStore } from "@/server/auth/creator";
import { getDb } from "@/server/db/client";
import { isV1Enabled, tryGetEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { createRateLimiter, type RateLimiter } from "@/server/ratelimit";
import { getRedis, requireRedis } from "@/server/redis";
import { requestHost, requestProtocol } from "@/server/request-guard";
import { type CreatorsDb, isDatabaseUnavailable } from "./db";
import type { AssetRegistry } from "./server";

/**
 * Shared plumbing for the thin `/api/v1/creators/*` handlers: the v1 gate, rate limiting and error
 * mapping. Origin, Content-Type and body-size rules live in middleware (M4) for every `/api/*` route. Dependencies are resolved through
 * `creatorDeps()` so route tests can swap in PGlite, an in-memory challenge store and a fixed clock.
 */

export type CreatorDeps = {
  db(): CreatorsDb;
  challenges(): ChallengeStore;
  /** Mints that may be used in a creator basket: listed, verified and not halted. */
  registry(): Promise<AssetRegistry>;
  now(): Date;
  limiter(name: string, limit: number, windowSeconds: number): RateLimiter;
};

/** Adapts @upstash/redis to the two commands the challenge store needs. */
export function redisChallengeStore(redis: Redis): ChallengeStore {
  return {
    set: (key, value, options) =>
      redis.set(key, value, { nx: true, ex: options.ex }),
    getdel: (key) => redis.getdel<string>(key),
  };
}

async function marketRegistry(): Promise<AssetRegistry> {
  const markets = await getMarkets();
  if (markets.state === "unavailable")
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      publicMessage:
        "The asset list is unavailable right now, so the basket cannot be checked. Try again shortly.",
      detail: "registry: markets unavailable",
    });
  return new Map(
    markets.data.rows
      .filter((row) => row.verified && !row.tradingHalted)
      .map((row) => [row.mint, { symbol: row.symbol }]),
  );
}

const limiters = new Map<string, RateLimiter>();

const defaults: CreatorDeps = {
  db: () => getDb(),
  challenges: () => redisChallengeStore(requireRedis()),
  registry: marketRegistry,
  now: () => new Date(),
  limiter(name, limit, windowSeconds) {
    let limiter = limiters.get(name);
    if (!limiter) {
      limiter = createRateLimiter({
        name: `creators:${name}`,
        limit,
        windowSeconds,
        redis: getRedis(),
        required: isV1Enabled(),
      });
      limiters.set(name, limiter);
    }
    return limiter;
  },
};

let overrides: Partial<CreatorDeps> = {};

export function creatorDeps(): CreatorDeps {
  return { ...defaults, ...overrides };
}

export function setCreatorDepsForTests(next: Partial<CreatorDeps>): void {
  overrides = next;
}

/** Same rule as middleware.ts: client headers are trusted only behind a proxy that sets them. */
function trustProxy(): boolean {
  const env = tryGetEnv();
  return (
    process.env.VERCEL === "1" ||
    (env.ok ? env.env.server.AROMA_TRUST_PROXY : false)
  );
}

/**
 * The site origin a challenge is bound to (the "Site:" line the wallet shows): AROMA_SITE_URL
 * when set, else the origin the client used, by the SAME rules as middleware's origin allowlist
 * (`requestProtocol`/`requestHost`: Host, and x-forwarded-* only behind a trusted proxy). Never
 * `request.url` alone: `next start` rewrites it to its bind address (localhost), which M4 found
 * and fixed in middleware. Cross-site requests never reach a handler: middleware refuses any
 * `/api/*` request whose Origin is not allowed (M5b A2, docs/M5-NEEDS-FROM-M4.md #2).
 */
export function expectedOrigin(request: Request): string {
  const env = tryGetEnv();
  const configured = env.ok ? env.env.server.AROMA_SITE_URL : undefined;
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  return `${requestProtocol(request.headers, url.protocol, process.env)}://${requestHost(request.headers, url.host, process.env)}`;
}

/** The client IP behind a trusted proxy, else one shared local bucket (as middleware.ts does). */
function clientKey(request: Request): string {
  if (!trustProxy()) return "local";
  const ip = (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    ""
  ).trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "unknown";
}

export type RouteOptions = {
  route: string;
  /** POST/DELETE (documentation only: middleware enforces Origin, JSON and body size). */
  mutation: boolean;
  limit: { name: string; limit: number; windowSeconds: number };
};

type Handler<C> = (request: Request, context: C) => Promise<Response>;
type PlainHandler = (request: Request) => Promise<Response>;

/** Wrap a handler: gate → rate limit → handler; every error becomes `{ code, message }`. */
export function creatorRoute(
  options: RouteOptions,
  handler: PlainHandler,
): PlainHandler;
export function creatorRoute<C>(
  options: RouteOptions,
  handler: Handler<C>,
): Handler<C>;
export function creatorRoute<C>(
  options: RouteOptions,
  handler: Handler<C>,
): Handler<C> {
  return async (request, context) => {
    try {
      if (!isV1Enabled())
        throw new AppError("NOT_FOUND", { detail: "v1 disabled" });
      // TODO(M5b): M4's middleware owns rate limits; this per-handler check moves there.
      const { name, limit, windowSeconds } = options.limit;
      const decision = await creatorDeps()
        .limiter(name, limit, windowSeconds)
        .check(clientKey(request));
      if (!decision.allowed) {
        const response = errorResponse(
          new AppError("RATE_LIMITED", { detail: `limiter ${name}` }),
          { route: options.route },
        );
        response.headers.set("Retry-After", String(decision.retryAfterSeconds));
        return response;
      }
      return await handler(request, context);
    } catch (error) {
      return errorResponse(
        isDatabaseUnavailable(error)
          ? new AppError("SERVICE_UNAVAILABLE", {
              detail: "database unavailable",
              cause: error,
            })
          : error,
        { route: options.route },
      );
    }
  };
}

export const noStore = { "Cache-Control": "no-store" } as const;
