/**
 * In-memory Redis and plans_index stores for LOCAL runs only: unit tests and the mainnet-fork
 * end to end (`pnpm --filter @aroma/contracts e2e:fork`). Production always uses Upstash and
 * Neon (services.ts); nothing here persists or is shared between processes.
 */
import type { PlanIndexRow } from "@aroma/guard";
import type { InstallmentReceipt, KeeperDb } from "./db";
import type { KeeperRedis } from "./store";

export function memoryRedis(): KeeperRedis & {
  store: Map<string, string>;
  lists: Map<string, string[]>;
} {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  return {
    store,
    lists,
    async set(key, value, o = {}) {
      if (o.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(...keys) {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    },
    async eval(_script, keys, args) {
      if (store.get(keys[0]!) === args[0]) {
        store.delete(keys[0]!);
        return 1;
      }
      return 0;
    },
    async incr(key) {
      const n = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(n));
      return n;
    },
    async expire() {
      return 1;
    },
    async lpush(key, ...values) {
      const list = lists.get(key) ?? [];
      list.unshift(...values.reverse());
      lists.set(key, list);
      return list.length;
    },
    async lrange(key, start, stop) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
    async llen(key) {
      return (lists.get(key) ?? []).length;
    },
    async lrem(key, _count, value) {
      const list = lists.get(key) ?? [];
      const i = list.indexOf(value);
      if (i < 0) return 0;
      list.splice(i, 1);
      return 1;
    },
  };
}

export function memoryDb(): KeeperDb & {
  rows: Map<string, PlanIndexRow>;
  receipts: InstallmentReceipt[];
  notifications: Map<string, { wallet: string; kind: string }>;
} {
  const rows = new Map<string, PlanIndexRow>();
  const receipts: InstallmentReceipt[] = [];
  const notifications = new Map<string, { wallet: string; kind: string }>();
  return {
    rows,
    receipts,
    notifications,
    async recordNotification(event) {
      if (notifications.has(event.id)) return false;
      notifications.set(event.id, { wallet: event.wallet, kind: event.kind });
      return true;
    },
    async dueRows(now, limit) {
      const t = BigInt(Math.floor(now.getTime() / 1000));
      return [...rows.values()]
        .filter(
          (r) =>
            r.status === "active" && r.nextDueAt !== null && r.nextDueAt <= t,
        )
        .slice(0, limit);
    },
    async allRows() {
      return [...rows.values()];
    },
    async upsertRows(list) {
      list.forEach((r) => rows.set(r.pda, { ...r }));
    },
    async closeRows(pdas) {
      pdas.forEach((p) => {
        const r = rows.get(p);
        if (r) rows.set(p, { ...r, status: "closed", nextDueAt: null });
      });
    },
    async insertInstallment(receipt) {
      if (receipts.some((r) => r.signature === receipt.signature)) return false;
      receipts.push(receipt);
      return true;
    },
  };
}
