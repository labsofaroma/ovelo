import "server-only";
import type { Redis } from "@upstash/redis";
import { getMarkets } from "@/features/markets/server";
import type { ChallengeStore } from "@/server/auth/creator";
import { getDb } from "@/server/db/client";
import { tryGetEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { requireRedis } from "@/server/redis";
import { localStores } from "@/features/trade/server/local";
import { requestHost, requestProtocol } from "@/server/request-guard";
import { type CreatorsDb, isDatabaseUnavailable } from "./db";
import type { AssetRegistry } from "./server";

/**
 * Shared plumbing for the thin `/api/v1/creators/*` handlers: the v1 gate and error mapping.
 * Origin, Content-Type, body-size and rate-limit rules live in middleware (M4) for every `/api/*`
 * route; challenge issuance and invite redemption use its tighter `creator` bucket (M5b A3). Dependencies are resolved through
 * `creatorDeps()` so route tests can swap in PGlite, an in-memory challenge store and a fixed clock.
 */

export type CreatorDeps = {
  db(): CreatorsDb;
  challenges(): ChallengeStore;
  /** Mints that may be used in a creator basket: listed, verified and not halted. */
  registry(): Promise<AssetRegistry>;
  now(): Date;
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

/**
 * Single-use nonces in process memory, for a local-fork E2E run only (no Redis there; one
 * `next start` process, so GETDEL is atomic). Same gate as M4's in-memory trade store.
 */
const localChallenges = new Map<string, { value: string; expires: number }>();
export function memoryChallengeStore(now = () => Date.now()): ChallengeStore {
  return {
    async set(key, value, options) {
      const existing = localChallenges.get(key);
      if (existing && existing.expires > now()) return null;
      localChallenges.set(key, { value, expires: now() + options.ex * 1000 });
      return "OK";
    },
    async getdel(key) {
      const entry = localChallenges.get(key);
      localChallenges.delete(key);
      return entry && entry.expires > now() ? entry.value : null;
    },
  };
}

const defaults: CreatorDeps = {
  db: () => getDb(),
  challenges: () =>
    localStores()
      ? memoryChallengeStore()
      : redisChallengeStore(requireRedis()),
  registry: marketRegistry,
  now: () => new Date(),
};

let overrides: Partial<CreatorDeps> = {};

export function creatorDeps(): CreatorDeps {
  return { ...defaults, ...overrides };
}

export function setCreatorDepsForTests(next: Partial<CreatorDeps>): void {
  overrides = next;
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

export type RouteOptions = {
  route: string;
  /** POST/DELETE (documentation only: middleware enforces Origin, JSON, body size and limits). */
  mutation: boolean;
};

type Handler<C> = (request: Request, context: C) => Promise<Response>;
type PlainHandler = (request: Request) => Promise<Response>;

/** Wrap a handler: gate → handler; every error becomes `{ code, message }`. */
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
