import { Pool, neonConfig } from "@neondatabase/serverless";
import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { PlanIndexRow } from "@aroma/guard";

/**
 * The two tables the keeper writes, declared with the same columns as the web app's migrations
 * (apps/web/server/db/migrations; `db.test.ts` applies those migrations and checks this file
 * against them). The keeper never creates or alters tables.
 */

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const plansIndex = pgTable("plans_index", {
  pda: text("pda").primaryKey(),
  owner: text("owner").notNull(),
  fundingMint: text("funding_mint").notNull(),
  nonce: text("nonce").notNull(),
  status: text("status").notNull(),
  nextDueAt: ts("next_due_at"),
  lastPeriod: integer("last_period"),
  skippedPeriods: integer("skipped_periods").notNull(),
  executedPeriods: integer("executed_periods").notNull(),
  periods: integer("periods"),
  updatedAt: ts("updated_at").notNull(),
});

export const receipts = pgTable("receipts", {
  signature: text("signature").primaryKey(),
  wallet: text("wallet").notNull(),
  kind: text("kind").notNull(),
  amountIn: text("amount_in").notNull(),
  mintIn: text("mint_in").notNull(),
  legs: jsonb("legs").$type<unknown[]>().notNull(),
  slot: bigint("slot", { mode: "bigint" }),
  blockTime: ts("block_time"),
  planPda: text("plan_pda"),
  period: integer("period"),
  status: text("status").notNull(),
});

export type InstallmentReceipt = {
  signature: string;
  wallet: string;
  amountIn: string;
  mintIn: string;
  legs: unknown[];
  slot: bigint | null;
  blockTime: Date | null;
  planPda: string;
  period: number;
};

export type KeeperDb = {
  dueRows(now: Date, limit: number): Promise<PlanIndexRow[]>;
  allRows(): Promise<PlanIndexRow[]>;
  upsertRows(rows: readonly PlanIndexRow[]): Promise<void>;
  closeRows(pdas: readonly string[]): Promise<void>;
  insertInstallment(receipt: InstallmentReceipt): Promise<boolean>;
};

type Drizzle = ReturnType<typeof drizzle>;
const toDate = (s: bigint | null) =>
  s === null ? null : new Date(Number(s) * 1000);
const toSeconds = (d: Date | null) =>
  d === null ? null : BigInt(Math.floor(d.getTime() / 1000));

const fromRow = (r: typeof plansIndex.$inferSelect): PlanIndexRow => ({
  pda: r.pda,
  owner: r.owner,
  fundingMint: r.fundingMint,
  nonce: r.nonce,
  status: r.status as PlanIndexRow["status"],
  nextDueAt: toSeconds(r.nextDueAt),
  lastPeriod: r.lastPeriod,
  skippedPeriods: r.skippedPeriods,
  executedPeriods: r.executedPeriods,
  periods: r.periods ?? 0,
});

export function keeperDb(
  db: Pick<Drizzle, "select" | "insert" | "update">,
): KeeperDb {
  return {
    async dueRows(now, limit) {
      const rows = await db
        .select()
        .from(plansIndex)
        .where(
          and(eq(plansIndex.status, "active"), lte(plansIndex.nextDueAt, now)),
        )
        .orderBy(asc(plansIndex.nextDueAt))
        .limit(limit);
      return rows.map(fromRow);
    },
    async allRows() {
      return (await db.select().from(plansIndex)).map(fromRow);
    },
    async upsertRows(rows) {
      for (const row of rows) {
        const values = {
          pda: row.pda,
          owner: row.owner,
          fundingMint: row.fundingMint,
          nonce: row.nonce,
          status: row.status,
          nextDueAt: toDate(row.nextDueAt),
          lastPeriod: row.lastPeriod,
          skippedPeriods: row.skippedPeriods,
          executedPeriods: row.executedPeriods,
          periods: row.periods,
          updatedAt: new Date(),
        };
        await db
          .insert(plansIndex)
          .values(values)
          .onConflictDoUpdate({ target: plansIndex.pda, set: values });
      }
    },
    async closeRows(pdas) {
      if (!pdas.length) return;
      await db
        .update(plansIndex)
        .set({ status: "closed", nextDueAt: null, updatedAt: new Date() })
        .where(
          and(
            inArray(plansIndex.pda, [...pdas]),
            ne(plansIndex.status, "closed"),
          ),
        );
    },
    async insertInstallment(receipt) {
      const inserted = await db
        .insert(receipts)
        .values({ ...receipt, kind: "installment", status: "confirmed" })
        .onConflictDoNothing({ target: receipts.signature })
        .returning({ signature: receipts.signature });
      return inserted.length > 0;
    },
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Neon serverless Pool; a loopback DATABASE_URL may use the local Neon wsproxy (local runs). */
export function connectDb(url: string, localProxy?: string): KeeperDb {
  if (
    localProxy &&
    LOOPBACK.has(new URL(url).hostname) &&
    /^(localhost|127\.0\.0\.1):\d{2,5}$/.test(localProxy)
  ) {
    neonConfig.wsProxy = () => `${localProxy}/v1`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
  }
  const pool = new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 5_000,
  });
  return keeperDb(drizzle({ client: pool }));
}
