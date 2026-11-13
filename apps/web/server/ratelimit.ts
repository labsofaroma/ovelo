import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { logger } from "./logger";

export type LimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  /** Which backend decided. "misconfigured" means we failed closed on a config error. */
  source: "redis" | "local" | "misconfigured";
};

export type RateLimiter = {
  readonly name: string;
  check(identifier: string): Promise<LimitDecision>;
};

type Options = {
  /** Namespaces keys in Redis, e.g. "api:read". */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Null/undefined means Redis is not configured. */
  redis: Redis | null | undefined;
  /**
   * When true (production, or v1 enabled), a missing Redis is a configuration error: every
   * request is denied (fail closed) instead of silently running unlimited.
   */
  required: boolean;
  /** Cap on tracked identifiers for the local fallback. Oldest entries are evicted. */
  maxLocalKeys?: number;
  now?: () => number;
};

/**
 * Per-process fallback used when Redis is unavailable (dev, or a Redis outage).
 * AUDIT H-4: when full it EVICTS THE OLDEST key instead of rejecting new identifiers, so an
 * attacker rotating IPs can never lock every new visitor out.
 */
export function createLocalLimiter(
  limit: number,
  windowSeconds: number,
  maxKeys = 10_000,
  now: () => number = Date.now,
) {
  const buckets = new Map<string, { count: number; until: number }>();
  const windowMs = windowSeconds * 1000;
  return (identifier: string): LimitDecision => {
    const time = now();
    let bucket = buckets.get(identifier);
    if (!bucket || bucket.until <= time) {
      bucket = { count: 0, until: time + windowMs };
    } else {
      buckets.delete(identifier); // re-insert below so recently active keys are evicted last
    }
    buckets.set(identifier, bucket);
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next();
      if (oldest.done) break;
      buckets.delete(oldest.value);
    }
    bucket.count += 1;
    const allowed = bucket.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((bucket.until - time) / 1000)),
      source: "local",
    };
  };
}

export function createRateLimiter(options: Options): RateLimiter {
  const { name, limit, windowSeconds, redis, required } = options;
  const local = createLocalLimiter(
    limit,
    windowSeconds,
    options.maxLocalKeys,
    options.now,
  );

  if (!redis && required) {
    logger.error(
      { limiter: name },
      "rate limiter is required but Redis is not configured; failing closed",
    );
    return {
      name,
      check: async () => ({
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: 30,
        source: "misconfigured",
      }),
    };
  }
  if (!redis) return { name, check: async (identifier) => local(identifier) };

  const upstash = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: `ratelimit:${name}`,
    timeout: 1500,
    analytics: false,
  });
  return {
    name,
    async check(identifier) {
      try {
        const result = await upstash.limit(identifier);
        return {
          allowed: result.success,
          limit: result.limit,
          remaining: result.remaining,
          retryAfterSeconds: result.success
            ? 0
            : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
          source: "redis",
        };
      } catch (err) {
        // A Redis outage must not take the site down: degrade to the bounded local limiter.
        logger.warn(
          { limiter: name, err },
          "redis rate limit failed; using local fallback",
        );
        return local(identifier);
      }
    },
  };
}
