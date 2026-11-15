import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import type { CreatorsDb } from "@/features/creators/db";
import {
  notificationEvents,
  notifications,
  notificationSubscriptions,
} from "@/server/db/schema";
import type { BetaChannel } from "../schema";
import type { DeliveryResult } from "./channels/types";
import type { EventRow } from "./render";

/**
 * The notification outbox (M11 Step 1).
 *
 * 1. `recordEvent`: one `notification_events` row per fact, with a deterministic id, so writing
 *    it again (a re-scan, a keeper retry) is a no-op.
 * 2. `fanOut`: each new event becomes one `notifications` row per active subscription that wants
 *    it, unique on (event id, channel), so a channel can never get two deliveries of one event.
 * 3. `claimDue` / `settle`: a worker locks due rows (SKIP LOCKED, with a lease), sends, then
 *    settles: `sent`, or a retry with exponential back-off, or `dead` after MAX_ATTEMPTS or a
 *    permanent failure. A worker that dies after sending lets the lease expire and the row is sent
 *    again: at-least-once, and the receiver dedupes on the event id (push `tag`).
 */
export type NotifyDb = CreatorsDb;

export const MAX_ATTEMPTS = 6;
export const LEASE_MS = 60_000;
/** Events older than this when first fanned out are dropped (no stale messages). */
export const FANOUT_MAX_AGE_MS = 24 * 3_600_000;
/** Delivered and dead rows, and their events, are deleted after this (data minimisation). */
export const RETENTION_MS = 30 * 24 * 3_600_000;

export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

export type NewEvent = {
  id: string;
  wallet: string;
  kind: string;
  cluster: "mainnet" | "devnet" | "none";
  payload: Record<string, unknown>;
};

/** Insert an event once; returns whether it was new. */
export async function recordEvent(
  db: NotifyDb,
  event: NewEvent,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .insert(notificationEvents)
    .values({ ...event, createdAt: now })
    .onConflictDoNothing({ target: notificationEvents.id })
    .returning({ id: notificationEvents.id });
  return rows.length > 0;
}

/**
 * Fan new events out to the subscriptions that want them. A `test` event goes only to the channel
 * it names; any other event only to channels verified before the event happened.
 */
export async function fanOut(
  db: NotifyDb,
  now: Date,
  limit = 200,
): Promise<number> {
  return db.transaction(async (tx) => {
    const events = await tx
      .select()
      .from(notificationEvents)
      .where(sql`${notificationEvents.fannedOutAt} IS NULL`)
      .orderBy(notificationEvents.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    let created = 0;
    for (const event of events) {
      const fresh =
        now.getTime() - event.createdAt.getTime() <= FANOUT_MAX_AGE_MS;
      if (fresh) {
        const occurred =
          typeof event.payload.occurredAt === "string"
            ? new Date(event.payload.occurredAt)
            : event.createdAt;
        const subs = await tx
          .select({ channel: notificationSubscriptions.channel })
          .from(notificationSubscriptions)
          .where(
            and(
              eq(notificationSubscriptions.wallet, event.wallet),
              eq(notificationSubscriptions.status, "active"),
              event.kind === "test"
                ? eq(
                    notificationSubscriptions.channel,
                    String(event.payload.channel) as BetaChannel,
                  )
                : and(
                    sql`${notificationSubscriptions.events} @> ${JSON.stringify([event.kind])}::jsonb`,
                    sql`${notificationSubscriptions.verifiedAt} <= ${occurred.toISOString()}::timestamptz`,
                  ),
            ),
          );
        if (subs.length) {
          const inserted = await tx
            .insert(notifications)
            .values(
              subs.map((s) => ({
                wallet: event.wallet,
                channel: s.channel,
                event: event.kind,
                eventId: event.id,
                nextAttemptAt: now,
                createdAt: now,
              })),
            )
            .onConflictDoNothing({
              target: [notifications.eventId, notifications.channel],
            })
            .returning({ id: notifications.id });
          created += inserted.length;
        }
      }
      await tx
        .update(notificationEvents)
        .set({ fannedOutAt: now })
        .where(eq(notificationEvents.id, event.id));
    }
    return created;
  });
}

export type Claimed = {
  id: string;
  wallet: string;
  channel: BetaChannel;
  attempts: number;
  event: EventRow | null;
  address: Record<string, unknown> | null;
};

/** Lock up to `limit` due deliveries for LEASE_MS and count the attempt. */
export async function claimDue(
  db: NotifyDb,
  now: Date,
  limit = 50,
): Promise<Claimed[]> {
  const iso = now.toISOString();
  const lease = new Date(now.getTime() + LEASE_MS).toISOString();
  type Row = {
    id: string;
    wallet: string;
    channel: BetaChannel;
    attempts: number;
    event_id: string;
  };
  // A row whose last allowed attempt was claimed but never settled (the worker died while
  // sending, every time) is dead-lettered here, so a poison delivery cannot loop forever.
  await db.execute(sql`
    UPDATE notifications SET status = 'dead', locked_until = NULL, last_error = 'lease_expired'
    WHERE status = 'pending' AND attempts >= ${MAX_ATTEMPTS}
      AND locked_until IS NOT NULL AND locked_until <= ${iso}::timestamptz`);
  const result = await db.execute(sql`
    UPDATE notifications SET locked_until = ${lease}::timestamptz, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM notifications
      WHERE status = 'pending' AND next_attempt_at <= ${iso}::timestamptz
        AND (locked_until IS NULL OR locked_until <= ${iso}::timestamptz)
      ORDER BY next_attempt_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, wallet, channel, attempts, event_id`);
  const rows = (result as unknown as { rows: Row[] }).rows;
  const out: Claimed[] = [];
  for (const row of rows) {
    const [event] = await db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, row.event_id));
    const [sub] = await db
      .select({ address: notificationSubscriptions.address })
      .from(notificationSubscriptions)
      .where(
        and(
          eq(notificationSubscriptions.wallet, row.wallet),
          eq(notificationSubscriptions.channel, row.channel),
          eq(notificationSubscriptions.status, "active"),
        ),
      );
    out.push({
      id: row.id,
      wallet: row.wallet,
      channel: row.channel,
      attempts: Number(row.attempts),
      event: event
        ? {
            id: event.id,
            kind: event.kind,
            cluster: event.cluster as EventRow["cluster"],
            payload: event.payload,
          }
        : null,
      address: sub?.address ?? null,
    });
  }
  return out;
}

/**
 * Record the outcome of one claimed delivery. Guarded by the attempt count, so a worker whose
 * lease expired (and whose row was claimed again) cannot overwrite the newer outcome.
 */
export async function settle(
  db: NotifyDb,
  claimed: Pick<Claimed, "id" | "wallet" | "channel" | "attempts">,
  result: DeliveryResult,
  now: Date,
): Promise<"sent" | "retry" | "dead"> {
  const guard = and(
    eq(notifications.id, claimed.id),
    eq(notifications.status, "pending"),
    eq(notifications.attempts, claimed.attempts),
  );
  if (result.ok) {
    await db
      .update(notifications)
      .set({ status: "sent", sentAt: now, lockedUntil: null, lastError: null })
      .where(guard);
    return "sent";
  }
  if (result.gone)
    await db
      .delete(notificationSubscriptions)
      .where(
        and(
          eq(notificationSubscriptions.wallet, claimed.wallet),
          eq(notificationSubscriptions.channel, claimed.channel),
        ),
      );
  const dead = !result.retry || claimed.attempts >= MAX_ATTEMPTS;
  await db
    .update(notifications)
    .set(
      dead
        ? { status: "dead", lockedUntil: null, lastError: result.code }
        : {
            lockedUntil: null,
            lastError: result.code,
            nextAttemptAt: new Date(
              now.getTime() + backoffMs(claimed.attempts),
            ),
          },
    )
    .where(guard);
  return dead ? "dead" : "retry";
}

/** Delete finished deliveries and old events (nothing keeps them past RETENTION_MS). */
export async function prune(db: NotifyDb, now: Date): Promise<void> {
  const before = new Date(now.getTime() - RETENTION_MS);
  await db
    .delete(notifications)
    .where(
      and(
        sql`${notifications.status} IN ('sent', 'dead')`,
        lt(notifications.createdAt, before),
      ),
    );
  await db
    .delete(notificationEvents)
    .where(
      and(
        lt(notificationEvents.createdAt, before),
        sql`NOT EXISTS (SELECT 1 FROM notifications n WHERE n.event_id = ${notificationEvents.id} AND n.status = 'pending')`,
      ),
    );
}
