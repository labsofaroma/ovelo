import "server-only";
import type { Address } from "@solana/kit";
import {
  executionsFromReceipts,
  planTimeline,
  viewPlan,
  type Timeline,
} from "@ovelo/guard";
import type { PlansResponse, PlanView } from "../schema";
import { buildCatalog, type CatalogAsset } from "./catalog";
import {
  chainNow,
  readAssets,
  readMint,
  readPlansByOwner,
  type PlanRead,
} from "./chain";
import type { InvestNetwork, InvestRpc } from "./cluster";
import { FUNDING_SYMBOL } from "./prepare";
import { backfillInstallments, reconcileIndex } from "./reconcile";
import type { InvestStore } from "./store";

/** GET /api/v1/plans?owner= (B3/B4): chain plans, reconciled into the index on read. */

export type PlansDeps = {
  network: InvestNetwork;
  rpc: InvestRpc;
  store: InvestStore;
};

export const PLANS_SOURCE =
  "Ovelo Guard v1 plan accounts and installment events on Solana";

async function timelineFor(
  deps: PlansDeps,
  read: PlanRead,
  now: bigint,
): Promise<Timeline> {
  const build = async () => {
    const receipts = await deps.store.receiptsForPlans([read.address]);
    const executions = executionsFromReceipts(
      receipts
        .filter((r) => r.kind === "installment" && r.status === "confirmed")
        .map((r) => ({
          signature: r.signature,
          period: r.period,
          blockTime: r.blockTime
            ? BigInt(Math.floor(r.blockTime.getTime() / 1000))
            : null,
          legs: r.legs,
        })),
    );
    return planTimeline({ plan: read.plan, now, executions });
  };
  const first = await build();
  if (first.consistent) return first;
  // Records are behind the chain: backfill from history once, then say what is still missing.
  await backfillInstallments({
    rpc: deps.rpc,
    store: deps.store,
    programId: deps.network.deployment.programId,
    plan: read,
  });
  return build();
}

function toView(
  read: PlanRead,
  timeline: Timeline,
  catalog: Map<string, CatalogAsset>,
  fundingDecimals: number,
  now: bigint,
): PlanView {
  const { plan } = read;
  const view = viewPlan(read.address, plan, now);
  const symbol = (mint: string) => catalog.get(mint)?.symbol ?? null;
  return {
    pda: read.address,
    owner: plan.owner,
    status:
      view.status === "paused"
        ? "paused"
        : view.status === "finished"
          ? "completed"
          : "active",
    fundingMint: plan.fundingMint,
    fundingSymbol: FUNDING_SYMBOL,
    fundingDecimals,
    installmentRaw: plan.fundingAmount.toString(),
    periodSeconds: plan.periodSeconds.toString(),
    periods: plan.periods,
    startsAt: plan.startsAt.toString(),
    expiresAt: plan.expiresAt.toString(),
    executedPeriods: plan.executedPeriods,
    skippedPeriods: plan.skippedPeriods,
    catchUpWindowPeriods: plan.catchUpWindowPeriods,
    outputs: plan.outputs.map((o) => ({
      mint: o.mint,
      symbol: symbol(o.mint),
      weightBps: o.weightBps,
    })),
    timeline: timeline.entries.map((e) => ({
      period: e.period,
      scheduledAt: e.scheduledAt.toString(),
      status: e.status,
      recordedOnChain: e.recordedOnChain,
      executions: e.executions.map((x) => ({
        signature: x.signature,
        blockTime: x.blockTime?.toString() ?? null,
        periodComplete: x.periodComplete,
        legs: x.legs.map((l) => ({
          leg: l.leg,
          mint: l.mint,
          symbol: symbol(l.mint),
          amountIn: l.amountIn.toString(),
          amountOut: l.amountOut.toString(),
          minOut: l.minOut.toString(),
          oraclePrice: l.oraclePrice.toString(),
          oracleExpo: l.oracleExpo,
          oraclePublishTime: l.oraclePublishTime.toString(),
        })),
      })),
    })),
    timelineComplete: timeline.consistent,
  };
}

export async function listPlans(
  deps: PlansDeps,
  owner: string,
): Promise<PlansResponse> {
  const { network, rpc } = deps;
  const [now, chain, assets, mint] = await Promise.all([
    chainNow(rpc),
    readPlansByOwner(rpc, network.deployment.programId, owner as Address),
    readAssets(rpc, network.deployment.programId),
    readMint(rpc, network.deployment.fundingMint),
  ]);
  await reconcileIndex(deps.store, chain, now, { owners: [owner] });
  const catalog = new Map(
    buildCatalog(assets).map((a) => [a.mint as string, a]),
  );
  const plans: PlanView[] = [];
  for (const read of chain.sort((a, b) =>
    Number(b.plan.createdAt - a.plan.createdAt),
  ))
    plans.push(
      toView(
        read,
        await timelineFor(deps, read, now),
        catalog,
        mint.decimals,
        now,
      ),
    );
  return {
    cluster: network.cluster,
    available: true,
    plans,
    asOf: now.toString(),
    source: PLANS_SOURCE,
  };
}
