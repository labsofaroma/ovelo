import type { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { createLocalLimiter, createRateLimiter } from "./ratelimit";

describe("local limiter (AUDIT H-4)", () => {
  it("limits one identifier within the window and resets after it", () => {
    let now = 0;
    const check = createLocalLimiter(2, 60, 100, () => now);
    expect(check("a").allowed).toBe(true);
    expect(check("a").allowed).toBe(true);
    const denied = check("a");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    now = 61_000;
    expect(check("a").allowed).toBe(true);
  });

  it("never locks out new identifiers when the key table is full: it evicts the oldest", () => {
    const check = createLocalLimiter(1, 60, 3, () => 0);
    for (const id of ["a", "b", "c"]) expect(check(id).allowed).toBe(true);
    // Table is full. The prototype rejected every new IP here; we must admit it.
    for (const id of ["d", "e", "f", "g"]) expect(check(id).allowed).toBe(true);
    // "a" was evicted long ago, so it starts a fresh bucket.
    expect(check("a").allowed).toBe(true);
  });

  it("an attacker flooding new keys does not unblock itself nor block a legitimate active client", () => {
    const check = createLocalLimiter(1, 60, 50, () => 0);
    expect(check("victim").allowed).toBe(true);
    expect(check("victim").allowed).toBe(false);
    for (let i = 0; i < 20; i++) check(`attacker-${i}`);
    expect(check("victim").allowed).toBe(false); // still tracked, not evicted
    expect(check("new-visitor").allowed).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("fails closed when Redis is required but not configured", async () => {
    const limiter = createRateLimiter({
      name: "t",
      limit: 5,
      windowSeconds: 60,
      redis: null,
      required: true,
    });
    const decision = await limiter.check("ip");
    expect(decision).toMatchObject({ allowed: false, source: "misconfigured" });
  });

  it("uses the local limiter when Redis is optional and absent", async () => {
    const limiter = createRateLimiter({
      name: "t",
      limit: 1,
      windowSeconds: 60,
      redis: undefined,
      required: false,
    });
    expect((await limiter.check("ip")).allowed).toBe(true);
    expect((await limiter.check("ip")).allowed).toBe(false);
  });

  it("degrades to the local limiter on a Redis outage instead of locking everyone out", async () => {
    const broken = {
      evalsha: () => Promise.reject(new Error("redis down")),
      eval: () => Promise.reject(new Error("redis down")),
    } as unknown as Redis;
    const limiter = createRateLimiter({
      name: "t",
      limit: 2,
      windowSeconds: 60,
      redis: broken,
      required: true,
    });
    const first = await limiter.check("ip");
    expect(first).toMatchObject({ allowed: true, source: "local" });
    expect((await limiter.check("another-ip")).allowed).toBe(true);
  });
});
