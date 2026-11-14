import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/features/creators/test/db";
import {
  DailyCapExceeded,
  reservationOf,
  reserve,
  settle,
  usedOn,
  type CapsDb,
} from "./store";

/** W3 store on Postgres (PGlite, migration 0006): atomic, replay-safe reservations. bigint only. */
let db: CapsDb;
let client: PGlite;
const DAY = "2026-11-14";
const CAP = 200_000_000n;
const LATER = new Date("2026-11-14T13:00:00.000Z");
let n = 0;
const wallet = () => `Caps${String(++n).padStart(6, "0")}${"z".repeat(34)}`;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());

const take = (
  w: string,
  amount: bigint,
  requestId: string = randomUUID(),
  cap = CAP,
) =>
  reserve(db, {
    requestId,
    wallet: w,
    day: DAY,
    amount,
    cap,
    resolveAfter: LATER,
  });

describe("trade cap store (0006)", () => {
  it("reserves up to the cap and refuses past it, inserting nothing", async () => {
    const w = wallet();
    expect(await take(w, 150_000_000n)).toBe("reserved");
    const id = randomUUID();
    await expect(take(w, 50_000_001n, id)).rejects.toBeInstanceOf(
      DailyCapExceeded,
    );
    expect(await reservationOf(db, id)).toBeNull();
    expect(await take(w, 50_000_000n)).toBe("reserved");
    expect(await usedOn(db, w, DAY)).toBe(CAP);
    await expect(take(w, 1n)).rejects.toMatchObject({ used: CAP });
  });

  it("a replayed request id counts once, in any state", async () => {
    const w = wallet();
    const id = randomUUID();
    expect(await take(w, 10n, id)).toBe("reserved");
    expect(await take(w, 10n, id)).toBe("replay");
    expect(await usedOn(db, w, DAY)).toBe(10n);
    await settle(db, id, "released");
    expect(await take(w, 10n, id)).toBe("replay");
    expect(await usedOn(db, w, DAY)).toBe(0n);
  });

  it("release gives the amount back once; confirm keeps it; settling twice is a no-op", async () => {
    const w = wallet();
    const a = randomUUID();
    const b = randomUUID();
    await take(w, 30n, a);
    await take(w, 40n, b);
    expect(await settle(db, a, "released")).toBe(true);
    expect(await settle(db, a, "released")).toBe(false);
    expect(await settle(db, a, "confirmed")).toBe(false);
    expect(await settle(db, b, "confirmed")).toBe(true);
    expect(await settle(db, b, "released")).toBe(false);
    expect(await usedOn(db, w, DAY)).toBe(40n);
  });

  it("the cap counts the wallet: another wallet has its own day", async () => {
    const a = wallet();
    const b = wallet();
    await take(a, CAP);
    expect(await take(b, CAP)).toBe("reserved");
  });

  it("parallel submits at the edge of the cap: exactly floor(cap / amount) succeed", async () => {
    const w = wallet();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => take(w, 50_000_000n)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(await usedOn(db, w, DAY)).toBe(CAP);
  });
});

type Op =
  | { kind: "submit"; amount: bigint }
  | { kind: "replay"; index: number }
  | { kind: "fail"; index: number }
  | { kind: "confirm"; index: number };

describe("no sequence passes the daily cap (property)", () => {
  it("quote/submit/replay/fail/confirm in any order keeps confirmed ≤ cap and the total exact", async () => {
    const op: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        kind: fc.constant("submit" as const),
        amount: fc.bigInt({ min: 1n, max: 80_000_000n }),
      }),
      fc.record({ kind: fc.constant("replay" as const), index: fc.nat(30) }),
      fc.record({ kind: fc.constant("fail" as const), index: fc.nat(30) }),
      fc.record({ kind: fc.constant("confirm" as const), index: fc.nat(30) }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(op, { minLength: 1, maxLength: 25 }),
        async (ops) => {
          const w = wallet();
          const issued: {
            id: string;
            amount: bigint;
            state: "reserved" | "confirmed" | "released";
          }[] = [];
          for (const step of ops) {
            if (step.kind === "submit") {
              const id = randomUUID();
              try {
                await take(w, step.amount, id);
                issued.push({ id, amount: step.amount, state: "reserved" });
              } catch (error) {
                expect(error).toBeInstanceOf(DailyCapExceeded);
              }
              continue;
            }
            const target = issued[step.index % Math.max(issued.length, 1)];
            if (!target) continue;
            if (step.kind === "replay")
              expect(await take(w, target.amount, target.id)).toBe("replay");
            if (
              step.kind === "fail" &&
              (await settle(db, target.id, "released"))
            )
              target.state = "released";
            if (
              step.kind === "confirm" &&
              (await settle(db, target.id, "confirmed"))
            )
              target.state = "confirmed";
          }
          const sum = (states: string[]) =>
            issued
              .filter((r) => states.includes(r.state))
              .reduce((acc, r) => acc + r.amount, 0n);
          expect(sum(["confirmed"]) <= CAP).toBe(true);
          expect(await usedOn(db, w, DAY)).toBe(sum(["reserved", "confirmed"]));
          expect(sum(["reserved", "confirmed"]) <= CAP).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
