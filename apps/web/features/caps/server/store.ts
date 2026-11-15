import { and, eq, lte, sql } from "drizzle-orm";
import type { CreatorsDb } from "@/features/creators/db";
import { tradeCapDays, tradeCapReservations } from "@/server/db/schema";

/**
 * Postgres side of the W3 caps (migration 0006). Chosen over Redis `INCRBY`: the daily total
 * must be durable (Upstash eviction or a flush would silently reset it), the beta gate already
 * requires Postgres (so this adds no new failure mode), and one transaction can tie the
 * reservation to the trade authorization's `request_id` (a replay inserts nothing and counts
 * nothing) AND move the total with a conditional UPDATE that Postgres row-locks, so concurrent
 * submits at the edge of the cap queue and re-check `used_raw + n <= cap`. Amounts are bigint.
 */
export type CapsDb = CreatorsDb;

export type Reservation = {
  requestId: string;
  wallet: string;
  day: string;
  amount: bigint;
  status: "reserved" | "confirmed" | "released";
  resolveAfter: Date;
  createdAt: Date;
  /** Solana Action quotes only: the authorized message's SHA-256 (settled from the chain). */
  actionMessageHash: string | null;
};

type Row = typeof tradeCapReservations.$inferSelect;
const toReservation = (row: Row): Reservation => ({
  requestId: row.requestId,
  wallet: row.wallet,
  day: row.day,
  amount: BigInt(row.amountRaw),
  status: row.status,
  resolveAfter: row.resolveAfter,
  createdAt: row.createdAt,
  actionMessageHash: row.actionMessageHash,
});

export class DailyCapExceeded extends Error {
  constructor(readonly used: bigint) {
    super("daily cap exceeded");
    this.name = "DailyCapExceeded";
  }
}

export async function usedOn(
  db: CapsDb,
  wallet: string,
  day: string,
): Promise<bigint> {
  const [row] = await db
    .select({ used: tradeCapDays.usedRaw })
    .from(tradeCapDays)
    .where(and(eq(tradeCapDays.wallet, wallet), eq(tradeCapDays.day, day)));
  return row ? BigInt(row.used) : 0n;
}

/**
 * Reserve `amount` for one authorization. Returns "replay" (and changes nothing) when this
 * request id already holds a reservation in any state. Throws DailyCapExceeded, inserting
 * nothing, when the wallet's day would pass `cap`.
 */
export async function reserve(
  db: CapsDb,
  input: {
    requestId: string;
    wallet: string;
    day: string;
    amount: bigint;
    cap: bigint;
    resolveAfter: Date;
    actionMessageHash?: string;
  },
): Promise<"reserved" | "replay"> {
  const amount = input.amount.toString();
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tradeCapReservations)
      .values({
        requestId: input.requestId,
        wallet: input.wallet,
        day: input.day,
        amountRaw: amount,
        resolveAfter: input.resolveAfter,
        actionMessageHash: input.actionMessageHash ?? null,
      })
      .onConflictDoNothing({ target: tradeCapReservations.requestId })
      .returning({ requestId: tradeCapReservations.requestId });
    if (!inserted.length) return "replay";
    await tx
      .insert(tradeCapDays)
      .values({ wallet: input.wallet, day: input.day })
      .onConflictDoNothing();
    const [moved] = await tx
      .update(tradeCapDays)
      .set({
        usedRaw: sql`${tradeCapDays.usedRaw} + ${amount}::numeric`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tradeCapDays.wallet, input.wallet),
          eq(tradeCapDays.day, input.day),
          sql`${tradeCapDays.usedRaw} + ${amount}::numeric <= ${input.cap.toString()}::numeric`,
        ),
      )
      .returning({ used: tradeCapDays.usedRaw });
    if (!moved) {
      const used = await usedOn(
        tx as unknown as CapsDb,
        input.wallet,
        input.day,
      );
      throw new DailyCapExceeded(used);
    }
    return "reserved";
  });
}

/**
 * Settle a reservation once: `confirmed` keeps it counting; `released` gives the amount back.
 * Only a `reserved` row moves, so settling twice (or confirming a released row) is a no-op.
 */
export async function settle(
  db: CapsDb,
  requestId: string,
  outcome: "confirmed" | "released",
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tradeCapReservations)
      .set({ status: outcome, settledAt: sql`now()` })
      .where(
        and(
          eq(tradeCapReservations.requestId, requestId),
          eq(tradeCapReservations.status, "reserved"),
        ),
      )
      .returning({
        wallet: tradeCapReservations.wallet,
        day: tradeCapReservations.day,
        amount: tradeCapReservations.amountRaw,
      });
    if (!row) return false;
    if (outcome === "released")
      await tx
        .update(tradeCapDays)
        .set({
          usedRaw: sql`${tradeCapDays.usedRaw} - ${row.amount}::numeric`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(tradeCapDays.wallet, row.wallet),
            eq(tradeCapDays.day, row.day),
          ),
        );
    return true;
  });
}

/** A wallet's reservations still `reserved` past their resolve time (to check on chain). */
export async function staleReservations(
  db: CapsDb,
  wallet: string,
  now: Date,
): Promise<Reservation[]> {
  const rows = await db
    .select()
    .from(tradeCapReservations)
    .where(
      and(
        eq(tradeCapReservations.wallet, wallet),
        eq(tradeCapReservations.status, "reserved"),
        lte(tradeCapReservations.resolveAfter, now),
      ),
    )
    .limit(20);
  return rows.map(toReservation);
}

export async function reservationOf(
  db: CapsDb,
  requestId: string,
): Promise<Reservation | null> {
  const [row] = await db
    .select()
    .from(tradeCapReservations)
    .where(eq(tradeCapReservations.requestId, requestId));
  return row ? toReservation(row) : null;
}
