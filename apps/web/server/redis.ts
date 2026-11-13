import "server-only";
import { Redis } from "@upstash/redis";
import { AppError } from "./errors";
import { tryGetEnv } from "./env";

let client: Redis | null | undefined;

/**
 * The shared Upstash Redis client, or null when it is not configured. Redis is used only for
 * caches, rate limits, keeper leases and idempotency keys (REWRITE-PLAN §6), never as a database.
 * Responses are not auto-deserialised: callers own their encoding.
 */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const result = tryGetEnv();
  const url = result.ok ? result.env.server.UPSTASH_REDIS_REST_URL : undefined;
  const token = result.ok
    ? result.env.server.UPSTASH_REDIS_REST_TOKEN
    : undefined;
  client =
    url && token
      ? new Redis({
          url,
          token,
          automaticDeserialization: false,
          retry: { retries: 1 },
        })
      : null;
  return client;
}

/** Like getRedis(), but a missing configuration is a SERVICE_UNAVAILABLE error (fail closed). */
export function requireRedis(): Redis {
  const redis = getRedis();
  if (!redis) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "Upstash Redis is not configured",
    });
  }
  return redis;
}

export function resetRedisForTests(): void {
  client = undefined;
}
