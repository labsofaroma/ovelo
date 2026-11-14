/** Test-only in-memory Redis with the commands the invest feature uses (TTL ignored). */
import type { LeaseRedis } from "@/server/lease";
import type { FaucetRedis } from "./faucet-limits";

export function memoryRedis(): LeaseRedis &
  FaucetRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key, value, options) {
      if (options.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(...keys) {
      for (const key of keys) store.delete(key);
      return keys.length;
    },
    async eval() {
      return null;
    },
    async incr(key) {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    },
    async decr(key) {
      const next = Number(store.get(key) ?? "0") - 1;
      store.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
  };
}
