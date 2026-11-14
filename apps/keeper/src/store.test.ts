import { describe, expect, it } from "vitest";
import {
  acquireLease,
  deadLetterCount,
  leaseKey,
  listDeadLetters,
  pushDeadLetter,
  releaseLease,
  removeDeadLetter,
} from "./store";
import { memoryRedis } from "./test/world";

const PDA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

describe("keeper store", () => {
  it("one lease per plan period; release only frees our own lease", async () => {
    const redis = memoryRedis();
    const first = await acquireLease(redis, PDA, 3, 1_000);
    expect(first?.key).toBe(`lease:plan:${PDA}:3`);
    expect(await acquireLease(redis, PDA, 3, 1_000)).toBeNull();
    expect(await acquireLease(redis, PDA, 4, 1_000)).not.toBeNull();
    await releaseLease(redis, { key: first!.key, token: "someone-else" });
    expect(await acquireLease(redis, PDA, 3, 1_000)).toBeNull();
    await releaseLease(redis, first!);
    expect(await acquireLease(redis, PDA, 3, 1_000)).not.toBeNull();
    expect(() => leaseKey("bad pda", 1)).toThrow();
    expect(() => leaseKey(PDA, -1)).toThrow();
  });

  it("dead letters are listed newest first, counted and removed by id", async () => {
    const redis = memoryRedis();
    const a = await pushDeadLetter(redis, {
      plan: PDA,
      period: 1,
      legMask: 1,
      code: "X",
      error: "e",
      attempts: 3,
    });
    const b = await pushDeadLetter(redis, {
      plan: PDA,
      period: 2,
      legMask: 1,
      code: "Y",
      error: "e",
      attempts: 1,
    });
    expect((await listDeadLetters(redis)).map((d) => d.entry.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(await deadLetterCount(redis)).toBe(2);
    expect(await removeDeadLetter(redis, a.id)).toBe(true);
    expect(await removeDeadLetter(redis, a.id)).toBe(false);
    await redis.lpush("keeper:dlq", "not json");
    expect((await listDeadLetters(redis)).map((d) => d.entry.id)).toEqual([
      b.id,
    ]);
  });
});
