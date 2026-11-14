import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase A private beta (REWRITE-PLAN §7.3 W2), migration `0005_beta_access`. Re-exported from
 * schema.ts. Same pattern as the M5 creator invites: only the SHA-256 of a code is stored, an
 * invite is single-use by default, always expires, and `uses <= max_uses` is a CHECK.
 */
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const betaInvites = pgTable(
  "beta_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    /** Always set: an invite without an expiry is refused at redemption (fail closed). */
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("beta_invites_hash_hex", sql`${t.codeHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "beta_invites_max_uses_range",
      sql`${t.maxUses} >= 1 AND ${t.maxUses} <= 100`,
    ),
    check(
      "beta_invites_uses_in_range",
      sql`${t.uses} >= 0 AND ${t.uses} <= ${t.maxUses}`,
    ),
  ],
);

/** One row per wallet with beta access; `invite_id` records which invite granted it. */
export const betaAccess = pgTable("beta_access", {
  wallet: text("wallet").primaryKey(),
  inviteId: uuid("invite_id")
    .notNull()
    .references(() => betaInvites.id, { onDelete: "restrict" }),
  grantedAt: timestamptz("granted_at").notNull().defaultNow(),
});
