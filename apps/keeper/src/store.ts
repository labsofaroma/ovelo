import { randomUUID } from "node:crypto";

/**
 * Keeper state in Redis (REWRITE-PLAN §6: caches, rate limits, leases, idempotency only):
 * - leases `lease:plan:{pda}:{period}` (one attempt per plan period at a time);
 * - the dead-letter list `keeper:dlq` (exhausted items, inspected and replayed by the CLI);
 * - alert de-duplication and rate-limit keys.
 * The program's period and leg bitmap is the final guard against double execution.
 */

export type KeeperRedis = {
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; ex?: number; px?: number },
  ): Promise<unknown>;
  get(key: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  llen(key: string): Promise<number>;
  lrem(key: string, count: number, value: string): Promise<number>;
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const DLQ_KEY = "keeper:dlq";
export const DLQ_SEEN_KEY = "keeper:dlq:seen";

export function leaseKey(pda: string, period: number): string {
  if (!BASE58.test(pda) || !Number.isSafeInteger(period) || period < 0)
    throw new Error("invalid lease key");
  return `lease:plan:${pda}:${period}`;
}

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export type Lease = { key: string; token: string };

/** SET NX PX: null when another run holds the period. */
export async function acquireLease(
  redis: KeeperRedis,
  pda: string,
  period: number,
  ttlMs: number,
): Promise<Lease | null> {
  const key = leaseKey(pda, period);
  const token = randomUUID();
  const ok = await redis.set(key, token, { nx: true, px: ttlMs });
  return ok === "OK" ? { key, token } : null;
}

/** Compare-and-delete, so a lease that expired and was taken by another run is never freed. */
export async function releaseLease(
  redis: KeeperRedis,
  lease: Lease,
): Promise<void> {
  await redis.eval(RELEASE, [lease.key], [lease.token]);
}

export type DeadLetter = {
  id: string;
  plan: string;
  period: number;
  legMask: number;
  code: string;
  error: string;
  attempts: number;
  at: string;
};

export async function pushDeadLetter(
  redis: KeeperRedis,
  entry: Omit<DeadLetter, "id" | "at">,
  now = new Date(),
): Promise<DeadLetter> {
  const full: DeadLetter = {
    id: randomUUID(),
    at: now.toISOString(),
    ...entry,
  };
  await redis.lpush(DLQ_KEY, JSON.stringify(full));
  return full;
}

const parse = (raw: unknown): DeadLetter | null => {
  try {
    const value = (
      typeof raw === "string" ? JSON.parse(raw) : raw
    ) as DeadLetter;
    return value &&
      typeof value.id === "string" &&
      typeof value.plan === "string"
      ? value
      : null;
  } catch {
    return null;
  }
};

export async function listDeadLetters(
  redis: KeeperRedis,
  limit = 100,
): Promise<{ entry: DeadLetter; raw: string }[]> {
  const raws = await redis.lrange(DLQ_KEY, 0, limit - 1);
  return raws.flatMap((raw) => {
    const entry = parse(raw);
    return entry
      ? [{ entry, raw: typeof raw === "string" ? raw : JSON.stringify(raw) }]
      : [];
  });
}

export async function removeDeadLetter(
  redis: KeeperRedis,
  id: string,
): Promise<boolean> {
  const match = (await listDeadLetters(redis, 1_000)).find(
    (item) => item.entry.id === id,
  );
  return match ? (await redis.lrem(DLQ_KEY, 1, match.raw)) > 0 : false;
}

export const deadLetterCount = (redis: KeeperRedis) => redis.llen(DLQ_KEY);
