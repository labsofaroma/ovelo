import "server-only";
import type { Redis } from "@upstash/redis";
import type { LeaseRedis } from "@/server/lease";
import type { FaucetRedis } from "./faucet-limits";

/** The few Redis commands the invest feature uses, over the Upstash REST client. */
export function upstashCommands(redis: Redis): LeaseRedis & FaucetRedis {
  return {
    set: (key, value, options) =>
      options.nx
        ? options.ex
          ? redis.set(key, value, { nx: true, ex: options.ex })
          : redis.set(key, value, { nx: true })
        : options.ex
          ? redis.set(key, value, { ex: options.ex })
          : redis.set(key, value),
    get: (key) => redis.get(key),
    del: (...keys) => redis.del(...keys),
    eval: (script, keys, args) => redis.eval(script, keys, args),
    incr: (key) => redis.incr(key),
    decr: (key) => redis.decr(key),
    expire: (key, seconds) => redis.expire(key, seconds),
  };
}
