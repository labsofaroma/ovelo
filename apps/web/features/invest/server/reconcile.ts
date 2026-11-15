import "server-only";
import type { Address, Signature } from "@solana/kit";
import {
  diffPlanIndex,
  indexRowFromPlan,
  installmentEvents,
  installmentRecord,
} from "@ovelo/guard";
import { logger } from "@/server/logger";
import type { PlanRead } from "./chain";
import type { InvestRpc } from "./cluster";
import type { InvestStore } from "./store";

/**
 * B4: the chain is the source of truth, `plans_index` and `receipts` are caches. Reconciliation
 * writes what the chain says, closes index rows whose plan is gone, and LOGS every difference
 * (a drift means a write was missed somewhere: submit, the keeper, or an outside executor).
 */

export async function reconcileIndex(
  store: InvestStore,
  chain: readonly PlanRead[],
  now: bigint,
  scope: { owners?: string[] } = {},
): Promise<{ drift: number }> {
  const rows = chain.map((p) => indexRowFromPlan(p.address, p.plan, now));
  const indexed = await store.indexRows(
    scope.owners?.length === 1 ? scope.owners[0] : undefined,
  );
  const { upserts, closes, drift } = diffPlanIndex(rows, indexed, scope);
  if (upserts.length) await store.upsertRows(upserts);
  if (closes.length) await store.closeRows(closes);
  for (const item of drift)
    logger.warn(
      { pda: item.pda, kind: item.kind, fields: item.fields },
      "plans_index drift repaired",
    );
  return { drift: drift.length };
}

/**
 * Backfill installment receipts for one plan from its transaction history (signatures newest
 * first, bounded). Only `InstallmentExecuted` events emitted by the v1 program for this plan
 * count; receipts are insert-once, so a replay changes nothing.
 */
export async function backfillInstallments(input: {
  rpc: InvestRpc;
  store: InvestStore;
  programId: Address;
  plan: PlanRead;
  limit?: number;
}): Promise<{ inserted: number }> {
  const { rpc, store, plan } = input;
  const known = new Set(
    (await store.receiptsForPlans([plan.address])).map((r) => r.signature),
  );
  const signatures = await rpc
    .getSignaturesForAddress(plan.address, {
      limit: input.limit ?? 200,
      commitment: "confirmed",
    })
    .send();
  let inserted = 0;
  for (const item of signatures) {
    if (item.err || known.has(item.signature)) continue;
    const tx = await rpc
      .getTransaction(item.signature as Signature, {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      })
      .send();
    if (!tx || tx.meta?.err) continue;
    for (const event of installmentEvents(
      tx.meta?.logMessages ?? [],
      input.programId,
    )) {
      if (event.plan !== plan.address) continue;
      const record = installmentRecord(event);
      const added = await store.insertReceipt({
        signature: item.signature,
        wallet: plan.plan.owner,
        kind: "installment",
        amountIn: record.amountIn.toString(),
        mintIn: plan.plan.fundingMint,
        legs: record.legs,
        slot: tx.slot,
        blockTime:
          tx.blockTime === null ? null : new Date(Number(tx.blockTime) * 1000),
        planPda: plan.address,
        period: event.period,
        status: "confirmed",
      });
      if (added) {
        inserted += 1;
        logger.warn(
          {
            plan: plan.address,
            signature: item.signature,
            period: event.period,
          },
          "installment receipt backfilled from chain history",
        );
      }
    }
  }
  return { inserted };
}
