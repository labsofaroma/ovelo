import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * M11 notifications (migration `0007_notifications`). Re-exported from schema.ts.
 *
 * - `notification_subscriptions`: one row per wallet and channel, opted in with a wallet
 *   signature. `address` holds the contact detail (a browser push subscription or a Telegram
 *   chat id) and is null until the channel is verified. Unsubscribing deletes the row (a hard
 *   delete); nothing else keeps the contact detail.
 * - `notification_events`: the outbox. One row per fact (a confirmed trade, a devnet round),
 *   keyed by a deterministic `id`, so writing the same event twice is a no-op.
 * - `notifications` (0000, extended here): one delivery per event and channel, unique on
 *   (`event_id`, `channel`), with its attempts, back-off and final state.
 */
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const SUBSCRIPTION_STATUSES = ["pending", "active"] as const;
/** `none`: a test message, which is about no cluster. */
export const NOTIFY_CLUSTERS = ["mainnet", "devnet", "none"] as const;

export const notificationSubscriptions = pgTable(
  "notification_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wallet: text("wallet").notNull(),
    channel: text("channel", { enum: ["email", "push", "telegram"] }).notNull(),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
    /** Event kinds this channel receives (a subset of NOTIFY_EVENTS). */
    events: jsonb("events").$type<string[]>().notNull(),
    /** The contact detail, once verified. Never logged, never returned by the API. */
    address: jsonb("address").$type<Record<string, unknown>>(),
    /** SHA-256 (hex) of the one-time Telegram code while `pending`. */
    verifyCodeHash: text("verify_code_hash"),
    verifyExpiresAt: timestamptz("verify_expires_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    verifiedAt: timestamptz("verified_at"),
  },
  (t) => [
    check(
      "notification_subscriptions_channel_valid",
      sql`${t.channel} IN ('email', 'push', 'telegram')`,
    ),
    check(
      "notification_subscriptions_status_valid",
      sql`${t.status} IN ('pending', 'active')`,
    ),
    check(
      "notification_subscriptions_active_has_address",
      sql`${t.status} <> 'active' OR ${t.address} IS NOT NULL`,
    ),
    unique("notification_subscriptions_wallet_channel").on(t.wallet, t.channel),
    unique("notification_subscriptions_code").on(t.verifyCodeHash),
  ],
);

export const notificationEvents = pgTable(
  "notification_events",
  {
    /** Deterministic: e.g. `trade:<request id>:confirmed`, `plan:<pda>:<period>:executed`. */
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    kind: text("kind").notNull(),
    cluster: text("cluster", { enum: NOTIFY_CLUSTERS }).notNull(),
    /** Facts for the message: raw amounts, mints, signatures. No contact detail. */
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** Set once the event has been fanned out to the wallet's subscriptions. */
    fannedOutAt: timestamptz("fanned_out_at"),
  },
  (t) => [
    check(
      "notification_events_cluster_valid",
      sql`${t.cluster} IN ('mainnet', 'devnet', 'none')`,
    ),
    index("notification_events_pending_idx").on(t.fannedOutAt, t.createdAt),
  ],
);
