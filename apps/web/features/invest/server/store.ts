import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { PlanIndexRow } from "@aroma/guard";
import type { Database } from "@/server/db/client";
import { plansIndex, receipts } from "@/server/db/schema";

/**
 * Postgres caches for the invest feature (REWRITE-PLAN §6): `plans_index` (the keeper's and the
 * UI's mirror of on-chain plans) and `receipts` (`plan_create`, `plan_close`, `installment`).
 * Receipts are insert-once by signature; a replayed write changes nothing.
 */

export type PlanReceipt = {
  signature: string;
  wallet: string;
  kind: "plan_create" | "plan_close" | "installment";
  /** Raw units of `mintIn`. */
  amountIn: string;
  mintIn: string;
  legs: unknown[];
  slot: bigint | null;
  blockTime: Date | null;
  planPda: string;
  period: number | null;
  status: "pending" | "confirmed" | "failed";
};

export type InvestStore = {
  indexRows(owner?: string): Promise<PlanIndexRow[]>;
  upsertRows(rows: readonly PlanIndexRow[]): Promise<void>;
  closeRows(pdas: readonly string[]): Promise<void>;
  insertReceipt(receipt: PlanReceipt): Promise<boolean>;
  receiptsForPlans(pdas: readonly string[]): Promise<PlanReceipt[]>;
};

const toDate = (seconds: bigint | null) =>
  seconds === null ? null : new Date(Number(seconds) * 1000);
const toSeconds = (date: Date | null) =>
  date === null ? null : BigInt(Math.floor(date.getTime() / 1000));

export function dbInvestStore(db: Database): InvestStore {
  return {
    async indexRows(owner) {
      const rows = await db
        .select()
        .from(plansIndex)
        .where(owner ? eq(plansIndex.owner, owner) : undefined);
      return rows.map((r) => ({
        pda: r.pda,
        owner: r.owner,
        fundingMint: r.fundingMint,
        nonce: r.nonce,
        status: r.status,
        nextDueAt: toSeconds(r.nextDueAt),
        lastPeriod: r.lastPeriod,
        skippedPeriods: r.skippedPeriods,
        executedPeriods: r.executedPeriods,
        periods: r.periods ?? 0,
      }));
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
    async insertReceipt(receipt) {
      const inserted = await db
        .insert(receipts)
        .values({
          signature: receipt.signature,
          wallet: receipt.wallet,
          kind: receipt.kind,
          amountIn: receipt.amountIn,
          mintIn: receipt.mintIn,
          legs: receipt.legs,
          slot: receipt.slot,
          blockTime: receipt.blockTime,
          planPda: receipt.planPda,
          period: receipt.period,
          status: receipt.status,
        })
        .onConflictDoNothing({ target: receipts.signature })
        .returning({ signature: receipts.signature });
      return inserted.length > 0;
    },
    async receiptsForPlans(pdas) {
      if (!pdas.length) return [];
      const rows = await db
        .select()
        .from(receipts)
        .where(inArray(receipts.planPda, [...pdas]));
      return rows.map((r) => ({
        signature: r.signature,
        wallet: r.wallet,
        kind: r.kind as PlanReceipt["kind"],
        amountIn: r.amountIn,
        mintIn: r.mintIn,
        legs: r.legs,
        slot: r.slot,
        blockTime: r.blockTime,
        planPda: r.planPda ?? "",
        period: r.period,
        status: r.status,
      }));
    },
  };
}

/** In-process store for unit tests (never used by a deployment). */
export function memoryInvestStore(): InvestStore & {
  rows: Map<string, PlanIndexRow>;
  receipts: Map<string, PlanReceipt>;
} {
  const rows = new Map<string, PlanIndexRow>();
  const stored = new Map<string, PlanReceipt>();
  return {
    rows,
    receipts: stored,
    async indexRows(owner) {
      return [...rows.values()]
        .filter((r) => !owner || r.owner === owner)
        .map((r) => ({ ...r }));
    },
    async upsertRows(list) {
      for (const row of list) rows.set(row.pda, { ...row });
    },
    async closeRows(pdas) {
      for (const pda of pdas) {
        const row = rows.get(pda);
        if (row) rows.set(pda, { ...row, status: "closed", nextDueAt: null });
      }
    },
    async insertReceipt(receipt) {
      if (stored.has(receipt.signature)) return false;
      stored.set(receipt.signature, { ...receipt });
      return true;
    },
    async receiptsForPlans(pdas) {
      const set = new Set(pdas);
      return [...stored.values()].filter((r) => set.has(r.planPda));
    },
  };
}
