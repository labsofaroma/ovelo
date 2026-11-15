import type { PGlite } from "@electric-sql/pglite";
import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/features/creators/test/db";
import type { Delivery, DeliveryResult } from "./channels/types";
import { memoryChannel } from "./channels/fakes";
import {
  backoffMs,
  claimDue,
  fanOut,
  LEASE_MS,
  MAX_ATTEMPTS,
  recordEvent,
  settle,
  type NotifyDb,
} from "./outbox";
import { activeSub, at, T0 } from "../test/fixtures";

let db: NotifyDb;
let client: PGlite;
beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());
beforeEach(async () => {
  await client.exec(
    "DELETE FROM notifications; DELETE FROM notification_events; DELETE FROM notification_subscriptions;",
  );
});

const event = (id: string, wallet = "w1", kind = "trade_confirmed") => ({
  id,
  wallet,
  kind,
  cluster: "mainnet" as const,
  payload: { occurredAt: T0.toISOString() },
});

/** One worker pass: claim what is due, send through the channel, settle. */
async function pass(
  now: Date,
  send: (d: Delivery, attempt: number) => DeliveryResult,
  crashAfterSend = false,
) {
  const channel = memoryChannel("telegram", send);
  for (const c of await claimDue(db, now)) {
    const result = await channel.send({
      eventId: c.event!.id,
      channel: c.channel,
      message: { title: "t", body: "b", url: "https://x" },
      address: c.address ?? {},
    });
    if (!crashAfterSend) await settle(db, c, result, now);
  }
  return channel.sent;
}

describe("outbox", () => {
  it("records an event once (deterministic id)", async () => {
    expect(await recordEvent(db, event("e1"), T0)).toBe(true);
    expect(await recordEvent(db, event("e1"), T0)).toBe(false);
  });

  it("fans out only to active channels that want the event and were verified before it", async () => {
    await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
    await activeSub(db, "w1", "push", ["trade_failed"]);
    await activeSub(db, "w2", "telegram", ["trade_confirmed"], at(60_000));
    await recordEvent(db, event("e1"), T0);
    await recordEvent(db, event("e2", "w2"), T0);
    expect(await fanOut(db, T0)).toBe(1);
    expect(await fanOut(db, T0)).toBe(0);
    const { rows } = await client.query<{ channel: string; event_id: string }>(
      "SELECT channel, event_id FROM notifications",
    );
    expect(rows).toEqual([{ channel: "telegram", event_id: "e1" }]);
  });

  it("drops events older than 24 hours instead of sending stale messages", async () => {
    await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
    await recordEvent(db, event("old"), T0);
    expect(await fanOut(db, at(25 * 3_600_000))).toBe(0);
  });

  it("retries with back-off, then dead-letters after MAX_ATTEMPTS", async () => {
    await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
    await recordEvent(db, event("e1"), T0);
    await fanOut(db, T0);
    let now = T0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await pass(now, () => ({
        ok: false,
        retry: true,
        gone: false,
        code: "http_503",
      }));
      now = new Date(now.getTime() + backoffMs(attempt));
    }
    const { rows } = await client.query<{
      status: string;
      attempts: number;
      last_error: string;
    }>("SELECT status, attempts, last_error FROM notifications");
    expect(rows).toEqual([
      { status: "dead", attempts: MAX_ATTEMPTS, last_error: "http_503" },
    ]);
  });

  it("a gone subscription is deleted (no address kept) and the delivery is dead", async () => {
    await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
    await recordEvent(db, event("e1"), T0);
    await fanOut(db, T0);
    await pass(T0, () => ({
      ok: false,
      retry: false,
      gone: true,
      code: "http_403",
    }));
    const subs = await client.query("SELECT 1 FROM notification_subscriptions");
    expect(subs.rows).toHaveLength(0);
  });

  it("a delivery whose worker dies on every attempt is dead-lettered, not retried forever", async () => {
    await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
    await recordEvent(db, event("e1"), T0);
    await fanOut(db, T0);
    let now = T0;
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      await pass(now, () => ({ ok: true }), true);
      now = new Date(now.getTime() + LEASE_MS + 1);
    }
    const { rows } = await client.query<{ status: string; last_error: string }>(
      "SELECT status, last_error FROM notifications",
    );
    expect(rows).toEqual([{ status: "dead", last_error: "lease_expired" }]);
  });

  it("a stale worker cannot overwrite a newer outcome (attempt guard)", async () => {
    await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
    await recordEvent(db, event("e1"), T0);
    await fanOut(db, T0);
    const [first] = await claimDue(db, T0);
    const later = at(LEASE_MS + 1);
    const [second] = await claimDue(db, later);
    expect(second?.attempts).toBe(2);
    await settle(db, second!, { ok: true }, later);
    await settle(
      db,
      first!,
      { ok: false, retry: false, gone: false, code: "late" },
      later,
    );
    const { rows } = await client.query<{ status: string }>(
      "SELECT status FROM notifications",
    );
    expect(rows).toEqual([{ status: "sent" }]);
  });
});

describe("outbox properties", () => {
  const scenario = fc.record({
    events: fc.uniqueArray(fc.integer({ min: 1, max: 40 }), {
      minLength: 1,
      maxLength: 8,
    }),
    /** For each event, how many attempts fail before success (≥ MAX_ATTEMPTS: never succeeds). */
    failures: fc.array(fc.integer({ min: 0, max: MAX_ATTEMPTS + 1 }), {
      minLength: 8,
      maxLength: 8,
    }),
    permanent: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    crashes: fc.array(fc.boolean(), { minLength: 14, maxLength: 14 }),
    duplicateWrites: fc.integer({ min: 1, max: 3 }),
  });

  it("no event is delivered twice per channel without a crash, and every event ends sent or dead", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        await client.exec(
          "DELETE FROM notifications; DELETE FROM notification_events; DELETE FROM notification_subscriptions;",
        );
        await activeSub(db, "w1", "telegram", ["trade_confirmed"]);
        for (let copy = 0; copy < s.duplicateWrites; copy += 1)
          for (const n of s.events) await recordEvent(db, event(`e${n}`), T0);
        await fanOut(db, T0);
        await fanOut(db, T0);
        const index = new Map(s.events.map((n, i) => [`e${n}`, i]));
        const delivered: string[] = [];
        let crashedSends = 0;
        let now = T0;
        for (let round = 0; round < 14; round += 1) {
          const crash = s.crashes[round]!;
          const sent = await pass(
            now,
            (d, attempt) => {
              const i = index.get(d.eventId)!;
              if (s.permanent[i])
                return { ok: false, retry: false, gone: false, code: "x" };
              return attempt > s.failures[i]!
                ? { ok: true }
                : { ok: false, retry: true, gone: false, code: "y" };
            },
            crash,
          );
          if (crash) crashedSends += sent.length;
          delivered.push(...sent.map((d) => d.eventId));
          now = new Date(
            now.getTime() + Math.max(LEASE_MS + 1, backoffMs(MAX_ATTEMPTS)),
          );
        }
        const { rows } = await client.query<{
          event_id: string;
          status: string;
        }>("SELECT event_id, status FROM notifications");
        // Exactly one delivery row per event and channel, however often the event was written.
        expect(rows).toHaveLength(s.events.length);
        // Every event ends sent or dead-lettered (none left pending).
        for (const row of rows) expect(["sent", "dead"]).toContain(row.status);
        // Extra deliveries come only from crashes between send and settle (at-least-once).
        const counts = new Map<string, number>();
        for (const id of delivered) counts.set(id, (counts.get(id) ?? 0) + 1);
        const extra = [...counts.values()].reduce((sum, n) => sum + n - 1, 0);
        expect(extra).toBeLessThanOrEqual(crashedSends);
        // A sent row was delivered at least once.
        for (const row of rows.filter((r) => r.status === "sent"))
          expect(counts.get(row.event_id) ?? 0).toBeGreaterThan(0);
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
