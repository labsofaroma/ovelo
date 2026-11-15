import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { feeShareLedger } from "@/server/db/schema";
import type { FeeSettings } from "@/server/env.fees";
import type { CreatorsDb } from "./db";

/**
 * Fee-share ledger, ACCOUNTING ONLY (M11 Step 5a). Each confirmed creator-basket order gets one
 * row (keyed by its request id): the notional is the order's raw input, the platform fee is
 * `notional × platformFeeBps / 10000` (0 in this build) and the creator's share is
 * `fee × shareBps / 10000`, both rounded down, in bigint. Recorded by the periodic worker from
 * receipts (the trade path stays frozen); a re-run adds nothing. No payout exists.
 */
export function feeFor(notional: bigint, settings: FeeSettings) {
  const fee = (notional * BigInt(settings.platformFeeBps)) / 10_000n;
  const share = (fee * BigInt(settings.creatorShareBps)) / 10_000n;
  return { fee, share };
}

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;

export async function syncFeeShareLedger(
  db: CreatorsDb,
  settings: FeeSettings,
  now: Date,
  limit = 500,
): Promise<number> {
  const orders = rowsOf<{
    order_id: string;
    basket_id: string;
    creator_wallet: string;
    mint_in: string;
    notional: string;
    order_at: string | Date;
  }>(
    await db.execute(sql`
      SELECT o.* FROM (
        SELECT coalesce(r.legs->0->>'requestId', r.signature) AS order_id,
               r.basket_id::text AS basket_id, b.creator_wallet, r.mint_in,
               sum(r.amount_in::numeric)::text AS notional, min(r.created_at) AS order_at,
               bool_and(r.status = 'confirmed') AS confirmed
        FROM receipts r JOIN baskets b ON b.id = r.basket_id
        WHERE r.kind = 'basket' AND b.creator_wallet IS NOT NULL
          AND r.created_at <= ${now.toISOString()}::timestamptz
        GROUP BY 1, r.basket_id, b.creator_wallet, r.mint_in
      ) o
      WHERE o.confirmed
        AND NOT EXISTS (SELECT 1 FROM fee_share_ledger l WHERE l.order_id = o.order_id)
      ORDER BY o.order_at
      LIMIT ${limit}`),
  );
  let recorded = 0;
  for (const order of orders) {
    const notional = BigInt(order.notional);
    const { fee, share } = feeFor(notional, settings);
    const inserted = await db
      .insert(feeShareLedger)
      .values({
        orderId: order.order_id,
        basketId: order.basket_id,
        creatorWallet: order.creator_wallet,
        notionalMint: order.mint_in,
        notionalRaw: notional.toString(),
        platformFeeBps: settings.platformFeeBps,
        shareBps: settings.creatorShareBps,
        feeRaw: fee.toString(),
        shareRaw: share.toString(),
        orderAt: new Date(order.order_at),
      })
      .onConflictDoNothing({ target: feeShareLedger.orderId })
      .returning({ id: feeShareLedger.orderId });
    recorded += inserted.length;
  }
  return recorded;
}

/** Per basket for the dashboard: ledger entries and the total share recorded (0 while off). */
export async function ledgerSummary(
  db: CreatorsDb,
  creatorWallet: string,
  basketId: string,
) {
  const [row] = await db
    .select({
      entries: sql<number>`count(*)::int`,
      shareRaw: sql<string>`coalesce(sum(${feeShareLedger.shareRaw}), 0)::text`,
    })
    .from(feeShareLedger)
    .where(
      and(
        eq(feeShareLedger.creatorWallet, creatorWallet),
        eq(feeShareLedger.basketId, basketId),
      ),
    );
  return { entries: row?.entries ?? 0, shareRaw: row?.shareRaw ?? "0" };
}
