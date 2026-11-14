import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { receipts } from "@/server/db/schema";
import type { ReceiptRow, ReceiptWriter } from "./store";

/**
 * Receipts in Postgres (M0 `receipts` table): one row per transaction signature, amounts as
 * raw-integer text (the table's CHECK enforces it), status pending → confirmed | failed. A
 * confirmed or failed row is never moved back. `basket_id` is set for creator baskets (rows in
 * `baskets`, M5b) and stays null for curated baskets, which are defined in lib/sdk (M4 decision
 * 6). The basket id, creator basket version and request id are kept on each leg.
 */
export function dbReceipts(db: Database): ReceiptWriter {
  return {
    async insertPending(rows) {
      if (!rows.length) return;
      await db
        .insert(receipts)
        .values(
          rows.map((row) => ({
            signature: row.signature,
            wallet: row.wallet,
            basketId: row.basketId,
            kind: row.kind,
            amountIn: row.amountIn,
            mintIn: row.mintIn,
            legs: row.legs,
            status: "pending" as const,
          })),
        )
        .onConflictDoNothing({ target: receipts.signature });
    },
    async mark(signatures, update) {
      if (!signatures.length) return;
      await db
        .update(receipts)
        .set({
          status: update.status,
          slot: update.slot,
          blockTime: update.blockTime,
        })
        .where(
          and(
            inArray(receipts.signature, [...signatures]),
            eq(receipts.status, "pending"),
          ),
        );
    },
    async listByWallet(wallet, limit) {
      const rows = await db
        .select()
        .from(receipts)
        .where(eq(receipts.wallet, wallet))
        .orderBy(desc(receipts.createdAt))
        .limit(limit);
      return rows.map((row): ReceiptRow => ({
        signature: row.signature,
        wallet: row.wallet,
        basketId: row.basketId,
        kind: row.kind === "basket" ? "basket" : "spot",
        amountIn: row.amountIn,
        mintIn: row.mintIn,
        legs: row.legs,
        slot: row.slot,
        blockTime: row.blockTime,
        status: row.status,
        createdAt: row.createdAt,
      }));
    },
  };
}
