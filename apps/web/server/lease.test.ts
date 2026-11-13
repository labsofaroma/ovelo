import { describe, expect, it } from "vitest";
import {
  acquireLease,
  idempotencyKey,
  type LeaseRedis,
  planLeaseKey,
  releaseLease,
  withIdempotency,
  withLease,
} from "./lease";

/** Minimal in-memory Redis implementing exactly the commands lease.ts uses. */
function fakeRedis(): LeaseRedis & { store: Map<string, string> } {
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
    async eval(_script, keys, args) {
      const key = keys[0] as string;
      if (store.get(key) === args[0]) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

const PDA = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5";

describe("planLeaseKey", () => {
  it("has the lease:plan:{pda}:{period} shape", () => {
    expect(planLeaseKey(PDA, 12)).toBe(`lease:plan:${PDA}:12`);
    expect(planLeaseKey(PDA, 5n)).toBe(`lease:plan:${PDA}:5`);
  });

  it("rejects key injection and bad periods", () => {
    expect(() => planLeaseKey("abc:def", 1)).toThrow();
    expect(() => planLeaseKey(`${PDA}\nDEL x`, 1)).toThrow();
    expect(() => planLeaseKey(PDA, -1)).toThrow();
    expect(() => planLeaseKey(PDA, 1.5)).toThrow();
  });
});

describe("leases", () => {
  it("grants exactly one holder per (plan, period)", async () => {
    const redis = fakeRedis();
    const key = planLeaseKey(PDA, 3);
    const a = await acquireLease(redis, key, 60);
    const b = await acquireLease(redis, key, 60);
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(false);
    expect((await acquireLease(redis, planLeaseKey(PDA, 4), 60)).acquired).toBe(
      true,
    );
  });

  it("only the owner can release; a stale token cannot free a re-acquired lease", async () => {
    const redis = fakeRedis();
    const key = planLeaseKey(PDA, 1);
    const first = await acquireLease(redis, key, 60);
    if (!first.acquired) throw new Error("expected lease");
    redis.store.delete(key); // simulate TTL expiry
    const second = await acquireLease(redis, key, 60);
    if (!second.acquired) throw new Error("expected lease");
    expect(await releaseLease(redis, first)).toBe(false);
    expect(redis.store.has(key)).toBe(true);
    expect(await releaseLease(redis, second)).toBe(true);
  });

  it("withLease skips work when held and releases after success or failure", async () => {
    const redis = fakeRedis();
    const key = planLeaseKey(PDA, 9);
    let runs = 0;
    const outcome = await withLease(redis, key, 60, async () => {
      runs += 1;
      const nested = await withLease(redis, key, 60, async () => (runs += 100));
      expect(nested.ran).toBe(false);
      return "done";
    });
    expect(outcome).toEqual({ ran: true, value: "done" });
    expect(runs).toBe(1);
    await expect(
      withLease(redis, key, 60, async () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    expect((await acquireLease(redis, key, 60)).acquired).toBe(true);
  });

  it("validates ttl", async () => {
    await expect(
      acquireLease(fakeRedis(), planLeaseKey(PDA, 1), 0),
    ).rejects.toThrow();
  });
});

describe("withIdempotency", () => {
  it("runs once and replays the stored result", async () => {
    const redis = fakeRedis();
    const key = idempotencyKey("trade", "req-1");
    let runs = 0;
    const first = await withIdempotency(redis, key, 60, async () => ({
      id: ++runs,
    }));
    const second = await withIdempotency(redis, key, 60, async () => ({
      id: ++runs,
    }));
    expect(first).toEqual({ replayed: false, value: { id: 1 } });
    expect(second).toEqual({ replayed: true, value: { id: 1 } });
    expect(runs).toBe(1);
  });

  it("rejects a concurrent duplicate and lets a failed run be retried", async () => {
    const redis = fakeRedis();
    const key = idempotencyKey("trade", "req-2");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inFlight = withIdempotency(redis, key, 60, async () => {
      await gate;
      return 1;
    });
    await expect(
      withIdempotency(redis, key, 60, async () => 2),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    release();
    await inFlight;

    const failing = idempotencyKey("trade", "req-3");
    await expect(
      withIdempotency(redis, failing, 60, async () =>
        Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom");
    await expect(
      withIdempotency(redis, failing, 60, async () => 7),
    ).resolves.toEqual({ replayed: false, value: 7 });
  });

  it("restricts key characters", () => {
    expect(() => idempotencyKey("trade", "a b")).toThrow();
    expect(() => idempotencyKey("tr:ade", "x")).toThrow();
  });
});
