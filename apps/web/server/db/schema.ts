import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema (REWRITE-PLAN §6). Conventions:
 * - Token amounts are `text` holding a base-10 unsigned integer in RAW UNITS (never floats,
 *   never decimals), enforced by `raw_amount` CHECKs. Read them with BigInt().
 * - `value_usd` is `numeric`, which Drizzle returns as an exact decimal string.
 * - A published basket's allocation weights must sum to exactly 10,000 bps. That cannot be a
 *   single-row CHECK, so it is enforced by deferred constraint triggers in the custom migration
 *   `0001_basket_weights_trigger.sql`.
 */

export const BPS_TOTAL = 10_000;
const rawAmount = (column: string) => sql.raw(`${column} ~ '^[0-9]+$'`);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamptz("expires_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("invites_max_uses_positive", sql`${t.maxUses} >= 1`),
    check(
      "invites_uses_in_range",
      sql`${t.uses} >= 0 AND ${t.uses} <= ${t.maxUses}`,
    ),
  ],
);

export const creators = pgTable("creators", {
  wallet: text("wallet").primaryKey(),
  displayName: text("display_name").notNull(),
  social: jsonb("social").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  inviteId: uuid("invite_id").references(() => invites.id, {
    onDelete: "restrict",
  }),
});

export const BASKET_STATUSES = ["draft", "published", "archived"] as const;

export const baskets = pgTable(
  "baskets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorWallet: text("creator_wallet").references(() => creators.wallet, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    ticker: text("ticker").notNull().unique(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: BASKET_STATUSES })
      .notNull()
      .default("draft"),
    version: integer("version").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    publishedAt: timestamptz("published_at"),
  },
  (t) => [
    check(
      "baskets_status_valid",
      sql`${t.status} IN ('draft', 'published', 'archived')`,
    ),
    check("baskets_version_positive", sql`${t.version} >= 1`),
    check(
      "baskets_published_has_timestamp",
      sql`${t.status} <> 'published' OR ${t.publishedAt} IS NOT NULL`,
    ),
    index("baskets_creator_idx").on(t.creatorWallet),
    index("baskets_status_idx").on(t.status),
  ],
);

export const basketAllocations = pgTable(
  "basket_allocations",
  {
    basketId: uuid("basket_id")
      .notNull()
      .references(() => baskets.id, { onDelete: "cascade" }),
    mint: text("mint").notNull(),
    symbol: text("symbol").notNull(),
    weightBps: integer("weight_bps").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.basketId, t.mint] }),
    unique("basket_allocations_basket_symbol_unique").on(t.basketId, t.symbol),
    check(
      "basket_allocations_weight_range",
      sql`${t.weightBps} BETWEEN 1 AND ${sql.raw(String(BPS_TOTAL))}`,
    ),
  ],
);

/**
 * Every published version of a creator basket, insert-only (migration 0002; triggers refuse UPDATE
 * and DELETE). `baskets` + `basket_allocations` hold the current version; a receipt leg records
 * the version it bought (`basketVersion`), which points here for the exact weights (M5b B3).
 */
export const basketVersions = pgTable(
  "basket_versions",
  {
    basketId: uuid("basket_id")
      .notNull()
      .references(() => baskets.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    ticker: text("ticker").notNull(),
    allocations: jsonb("allocations")
      .$type<{ mint: string; symbol: string; weightBps: number }[]>()
      .notNull(),
    publishedAt: timestamptz("published_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.basketId, t.version] }),
    check("basket_versions_version_positive", sql`${t.version} >= 1`),
  ],
);

export const RECEIPT_KINDS = [
  "spot",
  "basket",
  "plan_create",
  "plan_close",
  "installment",
] as const;
export const RECEIPT_STATUSES = ["pending", "confirmed", "failed"] as const;

export const receipts = pgTable(
  "receipts",
  {
    signature: text("signature").primaryKey(),
    wallet: text("wallet").notNull(),
    basketId: uuid("basket_id").references(() => baskets.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: RECEIPT_KINDS }).notNull(),
    amountIn: text("amount_in").notNull(),
    mintIn: text("mint_in").notNull(),
    legs: jsonb("legs").$type<unknown[]>().notNull().default([]),
    slot: bigint("slot", { mode: "bigint" }),
    blockTime: timestamptz("block_time"),
    status: text("status", { enum: RECEIPT_STATUSES })
      .notNull()
      .default("pending"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "receipts_kind_valid",
      sql`${t.kind} IN ('spot', 'basket', 'plan_create', 'plan_close', 'installment')`,
    ),
    check(
      "receipts_status_valid",
      sql`${t.status} IN ('pending', 'confirmed', 'failed')`,
    ),
    check("receipts_amount_in_raw", rawAmount("amount_in")),
    index("receipts_wallet_time_idx").on(t.wallet, t.blockTime),
    index("receipts_basket_idx").on(t.basketId),
  ],
);

export const PLAN_STATUSES = [
  "active",
  "paused",
  "completed",
  "closed",
] as const;

export const plansIndex = pgTable(
  "plans_index",
  {
    pda: text("pda").primaryKey(),
    owner: text("owner").notNull(),
    fundingMint: text("funding_mint").notNull(),
    /** u64 nonce as a decimal string. */
    nonce: text("nonce").notNull(),
    status: text("status", { enum: PLAN_STATUSES }).notNull().default("active"),
    nextDueAt: timestamptz("next_due_at"),
    lastPeriod: integer("last_period"),
    skippedPeriods: integer("skipped_periods").notNull().default(0),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "plans_index_status_valid",
      sql`${t.status} IN ('active', 'paused', 'completed', 'closed')`,
    ),
    check("plans_index_nonce_raw", rawAmount("nonce")),
    check("plans_index_skipped_nonneg", sql`${t.skippedPeriods} >= 0`),
    unique("plans_index_owner_funding_nonce_unique").on(
      t.owner,
      t.fundingMint,
      t.nonce,
    ),
    index("plans_index_due_idx").on(t.status, t.nextDueAt),
  ],
);

export const NOTIFICATION_CHANNELS = ["email", "push", "telegram"] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wallet: text("wallet").notNull(),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sentAt: timestamptz("sent_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "notifications_channel_valid",
      sql`${t.channel} IN ('email', 'push', 'telegram')`,
    ),
    index("notifications_wallet_idx").on(t.wallet, t.createdAt),
  ],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    wallet: text("wallet").notNull(),
    takenAt: timestamptz("taken_at").notNull(),
    holdings: jsonb("holdings").$type<unknown[]>().notNull(),
    /** Exact decimal string; never a float. */
    valueUsd: numeric("value_usd", { precision: 38, scale: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.wallet, t.takenAt] }),
    check("portfolio_snapshots_value_nonneg", sql`${t.valueUsd} >= 0`),
  ],
);
