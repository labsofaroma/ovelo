import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * M11 Step 5a (migration `0009_fee_share_ledger`): ACCOUNTING ONLY. One row per confirmed
 * creator-basket order: the basket, its creator, the order's notional and the creator's share in
 * basis points from configuration at the time it was recorded. The platform fee is 0 during the
 * beta, so `fee_raw` and `share_raw` are 0. No payout exists; nothing here moves money. Amounts
 * are raw units in `numeric(20,0)` (exact integers; read with BigInt()).
 */
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const raw = (name: string) => numeric(name, { precision: 20, scale: 0 });

export const feeShareLedger = pgTable(
  "fee_share_ledger",
  {
    /** The order (request id), so a multi-transaction basket buy is one entry. */
    orderId: text("order_id").primaryKey(),
    basketId: uuid("basket_id").notNull(),
    creatorWallet: text("creator_wallet").notNull(),
    notionalMint: text("notional_mint").notNull(),
    notionalRaw: raw("notional_raw").notNull(),
    platformFeeBps: integer("platform_fee_bps").notNull(),
    shareBps: integer("share_bps").notNull(),
    feeRaw: raw("fee_raw").notNull(),
    shareRaw: raw("share_raw").notNull(),
    orderAt: timestamptz("order_at").notNull(),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "fee_share_ledger_bps_range",
      sql`${t.platformFeeBps} BETWEEN 0 AND 10000 AND ${t.shareBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "fee_share_ledger_amounts_nonneg",
      sql`${t.notionalRaw} >= 0 AND ${t.feeRaw} >= 0 AND ${t.shareRaw} >= 0 AND ${t.shareRaw} <= ${t.feeRaw}`,
    ),
    index("fee_share_ledger_creator_idx").on(t.creatorWallet, t.orderAt),
  ],
);
