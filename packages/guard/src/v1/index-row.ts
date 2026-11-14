/**
 * The `plans_index` mirror of an on-chain plan, and the drift between the chain and the index
 * (B4). The chain is the source of truth; the index is a cache that is repaired, never trusted.
 */
import type { Address } from "@solana/kit";
import { NO_PERIOD } from "./constants";
import { viewPlan } from "./decoders";
import type { Plan } from "./generated";

export type IndexStatus = "active" | "paused" | "completed" | "closed";

export type PlanIndexRow = {
  pda: string;
  owner: string;
  fundingMint: string;
  nonce: string;
  status: IndexStatus;
  /** When the keeper should next look (unix seconds); null when nothing is left to run. */
  nextDueAt: bigint | null;
  lastPeriod: number | null;
  skippedPeriods: number;
  executedPeriods: number;
  periods: number;
};

export function indexRowFromPlan(
  address: Address,
  plan: Plan,
  now: bigint,
): PlanIndexRow {
  const view = viewPlan(address, plan, now);
  const status: IndexStatus =
    view.status === "paused"
      ? "paused"
      : view.status === "finished"
        ? "completed"
        : "active";
  const next =
    plan.lastExecutedPeriod === NO_PERIOD ? 0 : plan.lastExecutedPeriod + 1;
  let nextDueAt: bigint | null = null;
  if (status === "active") {
    if (view.status === "due" || view.status === "in_progress") nextDueAt = now;
    else if (next < plan.periods) {
      // The first period that can still run opens at max(next, index - window) ≥ next.
      const index = view.index ?? -1n;
      const oldest = index - BigInt(plan.catchUpWindowPeriods);
      const first = BigInt(next) > oldest ? BigInt(next) : oldest;
      const opens = plan.startsAt + plan.periodSeconds * first;
      nextDueAt = opens > now ? opens : now;
    }
  }
  return {
    pda: address,
    owner: plan.owner,
    fundingMint: plan.fundingMint,
    nonce: plan.nonce.toString(),
    status,
    nextDueAt,
    lastPeriod:
      plan.lastExecutedPeriod === NO_PERIOD ? null : plan.lastExecutedPeriod,
    skippedPeriods: plan.skippedPeriods,
    executedPeriods: plan.executedPeriods,
    periods: plan.periods,
  };
}

export type IndexDrift = {
  pda: string;
  /** missing: on chain, not indexed; stale: fields differ; orphan: indexed open, gone on chain. */
  kind: "missing" | "stale" | "orphan";
  fields: string[];
};

const COMPARED = [
  "owner",
  "fundingMint",
  "nonce",
  "status",
  "lastPeriod",
  "skippedPeriods",
  "executedPeriods",
  "periods",
] as const;

/**
 * What to write so the index matches the chain. `scope` limits orphan detection to the owners
 * that were read (a per-owner read must not close another owner's rows).
 */
export function diffPlanIndex(
  chain: readonly PlanIndexRow[],
  index: readonly PlanIndexRow[],
  scope: { owners?: readonly string[] } = {},
): { upserts: PlanIndexRow[]; closes: string[]; drift: IndexDrift[] } {
  const indexed = new Map(index.map((row) => [row.pda, row]));
  const onChain = new Set(chain.map((row) => row.pda));
  const upserts: PlanIndexRow[] = [];
  const drift: IndexDrift[] = [];
  for (const row of chain) {
    const current = indexed.get(row.pda);
    if (!current) {
      drift.push({ pda: row.pda, kind: "missing", fields: [] });
      upserts.push(row);
      continue;
    }
    const fields = COMPARED.filter((field) => current[field] !== row[field]);
    if (fields.length) drift.push({ pda: row.pda, kind: "stale", fields });
    // nextDueAt moves with time, so it is refreshed on every write but is not drift.
    upserts.push(row);
  }
  const owners = scope.owners ? new Set(scope.owners) : null;
  const closes: string[] = [];
  for (const row of index) {
    if (row.status === "closed" || onChain.has(row.pda)) continue;
    if (owners && !owners.has(row.owner)) continue;
    drift.push({ pda: row.pda, kind: "orphan", fields: ["status"] });
    closes.push(row.pda);
  }
  return { upserts, closes, drift };
}
