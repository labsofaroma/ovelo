import { randomUUID } from "node:crypto";
import { AppError } from "./errors";

/** The subset of Redis commands used here (satisfied by @upstash/redis and by test fakes). */
export type LeaseRedis = {
  set(
    key: string,
    value: string,
    options: { nx?: boolean; ex?: number },
  ): Promise<unknown>;
  get(key: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

declare const keyBrand: unique symbol;
/** A lease key builder output. Only the builders below can produce one. */
export type LeaseKey = string & { readonly [keyBrand]: "lease" };
export type IdempotencyKey = string & { readonly [keyBrand]: "idempotency" };

const BASE58_PDA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** `lease:plan:{pda}:{period}`: one keeper attempt per (plan, period). */
export function planLeaseKey(pda: string, period: number | bigint): LeaseKey {
  if (!BASE58_PDA.test(pda))
    throw new AppError("BAD_REQUEST", {
      detail: "invalid plan address in lease key",
    });
  const value = typeof period === "bigint" ? period : BigInt(period);
  if (
    value < 0n ||
    (typeof period === "number" && !Number.isSafeInteger(period))
  ) {
    throw new AppError("BAD_REQUEST", {
      detail: "invalid period in lease key",
    });
  }
  return `lease:plan:${pda}:${value}` as LeaseKey;
}

/** `idem:{scope}:{id}` for request idempotency. Scope and id are restricted to safe characters. */
export function idempotencyKey(scope: string, id: string): IdempotencyKey {
  const safe = /^[A-Za-z0-9_.-]{1,128}$/;
  if (!safe.test(scope) || !safe.test(id)) {
    throw new AppError("BAD_REQUEST", { detail: "invalid idempotency key" });
  }
  return `idem:${scope}:${id}` as IdempotencyKey;
}

export type Lease =
  { acquired: true; token: string; key: LeaseKey } | { acquired: false };

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** SET NX EX. The returned token proves ownership; only the owner can release. */
export async function acquireLease(
  redis: LeaseRedis,
  key: LeaseKey,
  ttlSeconds: number,
): Promise<Lease> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new AppError("BAD_REQUEST", {
      detail: "lease ttl must be a positive integer",
    });
  }
  const token = randomUUID();
  const result = await redis.set(key, token, { nx: true, ex: ttlSeconds });
  return result === "OK" ? { acquired: true, token, key } : { acquired: false };
}

/** Compare-and-delete: a lease that expired and was re-acquired elsewhere is never released by us. */
export async function releaseLease(
  redis: LeaseRedis,
  lease: Extract<Lease, { acquired: true }>,
): Promise<boolean> {
  const result = await redis.eval(RELEASE_SCRIPT, [lease.key], [lease.token]);
  return Number(result) === 1;
}

/** Run `work` only if the lease is free; returns `{ ran: false }` when someone else holds it. */
export async function withLease<T>(
  redis: LeaseRedis,
  key: LeaseKey,
  ttlSeconds: number,
  work: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const lease = await acquireLease(redis, key, ttlSeconds);
  if (!lease.acquired) return { ran: false };
  try {
    return { ran: true, value: await work() };
  } finally {
    await releaseLease(redis, lease).catch(() => undefined); // TTL is the backstop
  }
}

type Stored = { state: "pending" } | { state: "done"; result: unknown };

/**
 * Execute `work` at most once per key and replay its JSON result for repeats within the TTL.
 * A concurrent duplicate gets CONFLICT; a failed run clears the key so the client can retry.
 * `result` must be JSON-serialisable (no bigint: encode amounts as strings).
 */
export async function withIdempotency<T>(
  redis: LeaseRedis,
  key: IdempotencyKey,
  ttlSeconds: number,
  work: () => Promise<T>,
): Promise<{ replayed: boolean; value: T }> {
  const claimed = await redis.set(
    key,
    JSON.stringify({ state: "pending" } satisfies Stored),
    {
      nx: true,
      ex: ttlSeconds,
    },
  );
  if (claimed !== "OK") {
    const raw = await redis.get(key);
    const stored = typeof raw === "string" ? (JSON.parse(raw) as Stored) : null;
    if (stored?.state === "done")
      return { replayed: true, value: stored.result as T };
    throw new AppError("CONFLICT", {
      detail: "idempotent request already in progress",
    });
  }
  try {
    const value = await work();
    await redis.set(
      key,
      JSON.stringify({ state: "done", result: value } satisfies Stored),
      { ex: ttlSeconds },
    );
    return { replayed: false, value };
  } catch (error) {
    await redis.del(key).catch(() => undefined);
    throw error;
  }
}
