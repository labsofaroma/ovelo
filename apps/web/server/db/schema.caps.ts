import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase A per-day caps (REWRITE-PLAN §7.3 W3), migration `0006_trade_caps`. Re-exported from
 * schema.ts. Amounts are raw USDC units (6 decimals) in `numeric(20,0)`: an exact integer that
 * fits a u64, so Postgres can add and compare it atomically in one conditional UPDATE (Drizzle
 * returns it as a string; read it with BigInt()). Never a float.
 *
 * - `trade_cap_days`: one row per wallet and UTC day; `used_raw` = every reservation still
 *   counting (reserved or confirmed). The cap holds because the only increment is
 *   `UPDATE … SET used_raw = used_raw + n WHERE used_raw + n <= cap`.
 * - `trade_cap_reservations`: one row per trade authorization (`request_id`), so a replayed
 *   submit can never count twice. `reserved` → `confirmed` (kept) or `released` (given back).
 */
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const rawUsdc = (name: string) => numeric(name, { precision: 20, scale: 0 });

export const RESERVATION_STATUSES = [
  "reserved",
  "confirmed",
  "released",
] as const;

export const tradeCapDays = pgTable(
  "trade_cap_days",
  {
    wallet: text("wallet").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    usedRaw: rawUsdc("used_raw").notNull().default("0"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.wallet, t.day] }),
    check("trade_cap_days_used_nonnegative", sql`${t.usedRaw} >= 0`),
  ],
);

export const tradeCapReservations = pgTable(
  "trade_cap_reservations",
  {
    requestId: uuid("request_id").primaryKey(),
    wallet: text("wallet").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    amountRaw: rawUsdc("amount_raw").notNull(),
    status: text("status", { enum: RESERVATION_STATUSES })
      .notNull()
      .default("reserved"),
    /** After this, a still-`reserved` row is checked against the chain and settled. */
    resolveAfter: timestamptz("resolve_after").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    settledAt: timestamptz("settled_at"),
  },
  (t) => [
    check("trade_cap_reservations_amount_positive", sql`${t.amountRaw} > 0`),
    check(
      "trade_cap_reservations_status_valid",
      sql`${t.status} IN ('reserved', 'confirmed', 'released')`,
    ),
    index("trade_cap_reservations_wallet_status").on(t.wallet, t.status),
  ],
);
