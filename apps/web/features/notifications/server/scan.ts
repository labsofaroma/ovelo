import "server-only";
import { sql } from "drizzle-orm";
import { recordEvent, type NotifyDb } from "./outbox";

/**
 * Mainnet trade events from Aroma's own receipts (M11 Step 1). The trade path stays frozen
 * (rule 7), so instead of writing the event inside the confirm step, the worker scans recent
 * receipts and records each fact once (deterministic event ids; re-scans are no-ops):
 *
 * - `trade_confirmed`: every receipt of the order (one request id) is confirmed;
 * - `trade_failed`: any receipt of the order failed;
 * - `trade_unconfirmed`: an order still pending 15 minutes after Aroma recorded it (no claim
 *   that it expired: only that Aroma has not seen it confirm);
 * - `creator_basket_bought`: a confirmed creator-basket order, sent to the basket's creator.
 *
 * Only orders by wallets with an active subscription verified before the order are read, within
 * the last 24 hours, at most `limit` per kind. Installments are the keeper's (apps/keeper).
 */
export const UNCONFIRMED_AFTER_MS = 15 * 60_000;
const WINDOW_MS = 24 * 3_600_000;

export type ScanDeps = {
  /** Display label for a mint (catalog symbol), or null: the event then shows a short mint. */
  symbolOf(mint: string): string | null;
  /** Display name for a curated basket slug, or null. */
  basketNameOf(ref: string): string | null;
};

type OrderRow = {
  order_id: string;
  wallet: string;
  kind: "spot" | "basket";
  mint_in: string;
  amount: string;
  first_sig: string;
  first_mint: string | null;
  basket_ref: string | null;
  basket_id: string | null;
  basket_name: string | null;
  creator_wallet: string | null;
  any_failed: boolean;
  all_confirmed: boolean;
  created: string | Date;
};

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;

function orders(
  db: NotifyDb,
  since: Date,
  audience: "buyer" | "creator",
  limit: number,
) {
  const subscribed =
    audience === "buyer"
      ? sql`s.wallet = r.wallet`
      : sql`s.wallet = b.creator_wallet AND r.status = 'confirmed'`;
  return db.execute(sql`
    SELECT coalesce(r.legs->0->>'requestId', r.signature) AS order_id,
           r.wallet, r.kind, r.mint_in,
           sum(r.amount_in::numeric)::text AS amount,
           min(r.signature) AS first_sig,
           min(r.legs->0->>'mint') AS first_mint,
           min(r.legs->0->>'basket') AS basket_ref,
           min(r.basket_id::text) AS basket_id,
           min(b.name) AS basket_name,
           min(b.creator_wallet) AS creator_wallet,
           bool_or(r.status = 'failed') AS any_failed,
           bool_and(r.status = 'confirmed') AS all_confirmed,
           min(r.created_at) AS created
    FROM receipts r
    LEFT JOIN baskets b ON b.id = r.basket_id
    WHERE r.kind IN ('spot', 'basket')
      AND r.created_at >= ${since.toISOString()}::timestamptz
      ${audience === "creator" ? sql`AND r.basket_id IS NOT NULL` : sql``}
      AND EXISTS (
        SELECT 1 FROM notification_subscriptions s
        WHERE ${subscribed} AND s.status = 'active' AND s.verified_at <= r.created_at
      )
    GROUP BY 1, r.wallet, r.kind, r.mint_in
    ORDER BY min(r.created_at) DESC
    LIMIT ${limit}`);
}

const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

export async function scanReceipts(
  db: NotifyDb,
  deps: ScanDeps,
  now: Date,
  limit = 500,
): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_MS);
  let recorded = 0;
  for (const row of rowsOf<OrderRow>(await orders(db, since, "buyer", limit))) {
    const created = new Date(row.created);
    const status = row.any_failed
      ? "failed"
      : row.all_confirmed
        ? "confirmed"
        : now.getTime() - created.getTime() >= UNCONFIRMED_AFTER_MS
          ? "unconfirmed"
          : null;
    if (!status) continue;
    const label =
      row.kind === "basket"
        ? (row.basket_name ??
          (row.basket_ref ? deps.basketNameOf(row.basket_ref) : null) ??
          "basket")
        : row.first_mint
          ? (deps.symbolOf(row.first_mint) ?? shortMint(row.first_mint))
          : "token";
    if (
      await recordEvent(
        db,
        {
          id: `trade:${row.order_id}:${status}`,
          wallet: row.wallet,
          kind: `trade_${status}`,
          cluster: "mainnet",
          payload: {
            target: row.kind,
            label,
            mint: row.mint_in,
            amountRaw: row.amount,
            signature: row.first_sig,
            occurredAt: created.toISOString(),
          },
        },
        now,
      )
    )
      recorded += 1;
  }
  for (const row of rowsOf<OrderRow>(
    await orders(db, since, "creator", limit),
  )) {
    if (
      !row.all_confirmed ||
      !row.creator_wallet ||
      !row.basket_id ||
      !row.basket_name
    )
      continue;
    if (
      await recordEvent(
        db,
        {
          id: `creator-buy:${row.order_id}`,
          wallet: row.creator_wallet,
          kind: "creator_basket_bought",
          cluster: "mainnet",
          payload: {
            basketId: row.basket_id,
            basketName: row.basket_name,
            mint: row.mint_in,
            amountRaw: row.amount,
            occurredAt: new Date(row.created).toISOString(),
          },
        },
        now,
      )
    )
      recorded += 1;
  }
  return recorded;
}
