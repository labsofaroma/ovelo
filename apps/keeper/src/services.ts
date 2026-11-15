import { Redis } from "@upstash/redis";
import { connectDb, type KeeperDb } from "./db";
import type { KeeperEnv } from "./env";
import type { Logger } from "./log";
import type { RunDeps } from "./run";
import type { KeeperRedis } from "./store";

/** Production clients from the validated environment (Upstash REST, Neon Postgres). */
export function keeperRedis(env: KeeperEnv): KeeperRedis {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    automaticDeserialization: false,
    retry: { retries: 2 },
  });
  return {
    set: (key, value, o = {}) =>
      o.nx
        ? o.px
          ? redis.set(key, value, { nx: true, px: o.px })
          : o.ex
            ? redis.set(key, value, { nx: true, ex: o.ex })
            : redis.set(key, value, { nx: true })
        : o.ex
          ? redis.set(key, value, { ex: o.ex })
          : redis.set(key, value),
    get: (key) => redis.get(key),
    del: (...keys) => redis.del(...keys),
    eval: (script, keys, args) => redis.eval(script, keys, args),
    incr: (key) => redis.incr(key),
    expire: (key, seconds) => redis.expire(key, seconds),
    lpush: (key, ...values) => redis.lpush(key, ...values),
    lrange: (key, start, stop) => redis.lrange(key, start, stop),
    llen: (key) => redis.llen(key),
    lrem: (key, count, value) => redis.lrem(key, count, value),
  };
}

export function runDeps(
  env: KeeperEnv,
  log: Logger,
  db: KeeperDb = connectDb(env.DATABASE_URL, env.OVELO_LOCAL_NEON_WS_PROXY),
): RunDeps {
  return {
    env,
    db,
    redis: keeperRedis(env),
    log,
    alerts: {
      cluster: env.KEEPER_CLUSTER,
      webhookUrl: env.KEEPER_ALERT_WEBHOOK_URL,
      format: env.KEEPER_ALERT_FORMAT,
    },
  };
}
