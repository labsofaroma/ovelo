import type { Address, KeyPairSigner } from "@solana/kit";
import {
  indexRowFromPlan,
  installmentEvents,
  installmentRecord,
  NO_PERIOD,
  planLegBatches,
  viewPlan,
  type Config,
  type Plan,
} from "@aroma/guard";
import type { HermesLatestUpdates } from "@aroma/guard/pyth";
import { sendAlert, type AlertDeps } from "./alerts";
import {
  executeInstruction,
  freshUpdates,
  HermesUnavailable,
  legInfos,
  missingAccounts,
  pricePlan,
} from "./build";
import type { KeeperDb } from "./db";
import type { Logger } from "./log";
import type { KeeperRpc } from "./rpc";
import {
  PermanentError,
  RetriesExhausted,
  sendInstructions,
  type SendDeps,
} from "./send";
import {
  acquireLease,
  pushDeadLetter,
  releaseLease,
  type KeeperRedis,
} from "./store";

/**
 * One plan, one period (B5). The period is always the OLDEST runnable one (the program refuses
 * anything else); periods that fell out of the catch-up window are recorded as skipped by that
 * execution, and alerted. Legs run in batches of ≤ 3 with `leg_mask`. A lease per (plan, period)
 * keeps two runs apart; the program's bitmap is the final guard. Exhausted or permanent failures
 * go to the dead-letter list and alert.
 */

export type ExecuteDeps = {
  rpc: KeeperRpc;
  keeper: KeyPairSigner;
  db: KeeperDb;
  redis: KeeperRedis;
  log: Logger;
  alerts: AlertDeps;
  send: Omit<SendDeps, "rpc" | "keeper" | "log">;
  hermes: {
    latestUpdates(ids: readonly string[]): Promise<HermesLatestUpdates>;
  };
  config: Config;
  leaseMs?: number;
};

export type Outcome =
  | {
      status: "executed";
      plan: string;
      period: number;
      signatures: string[];
      newlySkipped: number;
    }
  | {
      status: "not_due" | "paused" | "lease_held";
      plan: string;
      period: number | null;
    }
  | { status: "deferred"; plan: string; period: number; reason: string }
  | { status: "dead_lettered"; plan: string; period: number; code: string };

async function readPlan(
  rpc: KeeperRpc,
  address: Address,
  decode: (data: Uint8Array) => Plan,
): Promise<Plan | null> {
  const { value } = await rpc
    .getAccountInfo(address, { encoding: "base64", commitment: "confirmed" })
    .send();
  return value
    ? decode(Uint8Array.from(Buffer.from(value.data[0], "base64")))
    : null;
}

export async function executePlan(
  deps: ExecuteDeps,
  address: Address,
  decode: (data: Uint8Array) => Plan,
  now: bigint,
): Promise<Outcome> {
  const plan = await readPlan(deps.rpc, address, decode);
  if (!plan) {
    await deps.db.closeRows([address]);
    return { status: "not_due", plan: address, period: null };
  }
  const view = viewPlan(address, plan, now);
  await deps.db.upsertRows([indexRowFromPlan(address, plan, now)]);
  if (view.status === "paused")
    return { status: "paused", plan: address, period: null };
  if (!view.due) {
    if (view.skippedIncludingPending > plan.skippedPeriods)
      await skipAlert(
        deps,
        address,
        plan,
        view.skippedIncludingPending - plan.skippedPeriods,
        "cannot run any more",
      );
    return { status: "not_due", plan: address, period: null };
  }
  const period = view.due.period;
  const lease = await acquireLease(
    deps.redis,
    address,
    period,
    deps.leaseMs ?? 180_000,
  );
  if (!lease) return { status: "lease_held", plan: address, period };
  const log = deps.log.child({ plan: address, period });
  log.info({ lease: lease.key }, "lease acquired");
  try {
    if (view.due.newlySkipped > 0)
      await skipAlert(
        deps,
        address,
        plan,
        view.due.newlySkipped,
        `will be recorded as skipped when period ${period} runs`,
      );
    const signatures: string[] = [];
    let current = plan;
    const masks = planLegBatches(plan.outputs.length)
      .map((mask) => mask & ~current.legBitmap)
      .filter((mask) => mask !== 0);
    for (const mask of masks) {
      const legs = plan.outputs
        .map((_, i) => i)
        .filter((i) => (mask >>> i) & 1);
      try {
        signatures.push(
          ...(await runBatch(deps, address, current, period, mask, legs, now)),
        );
      } catch (error) {
        if (error instanceof HermesUnavailable) {
          await sendAlert(deps.alerts, {
            kind: "hermes_unavailable",
            subject: error.kind,
            title: `Pyth Hermes ${error.kind}: installments are deferred`,
            details: {
              reason: error.message,
              plan: address,
              period: String(period),
            },
          });
          return {
            status: "deferred",
            plan: address,
            period,
            reason: error.kind,
          };
        }
        const code =
          error instanceof PermanentError
            ? error.code
            : error instanceof RetriesExhausted
              ? "RETRIES_EXHAUSTED"
              : "UNEXPECTED";
        const message = error instanceof Error ? error.message : String(error);
        const attempts = error instanceof RetriesExhausted ? error.attempts : 1;
        await pushDeadLetter(deps.redis, {
          plan: address,
          period,
          legMask: mask,
          code,
          error: message.slice(0, 500),
          attempts,
        });
        await sendAlert(deps.alerts, {
          kind: "installment_failed",
          subject: `${address}:${period}`,
          title: `Installment failed for plan ${address}, period ${period}`,
          details: {
            code,
            error: message.slice(0, 300),
            legMask: String(mask),
            attempts: String(attempts),
          },
        });
        log.error(
          { err: error, code, legMask: mask },
          "installment dead-lettered",
        );
        return { status: "dead_lettered", plan: address, period, code };
      }
      current = (await readPlan(deps.rpc, address, decode)) ?? current;
    }
    await deps.db.upsertRows([indexRowFromPlan(address, current, now)]);
    log.info(
      { signatures, newlySkipped: view.due.newlySkipped },
      "installment executed",
    );
    return {
      status: "executed",
      plan: address,
      period,
      signatures,
      newlySkipped: view.due.newlySkipped,
    };
  } finally {
    await releaseLease(deps.redis, lease).catch((err: unknown) =>
      log.error({ err }, "lease release failed"),
    );
  }
}

async function skipAlert(
  deps: ExecuteDeps,
  address: Address,
  plan: Plan,
  count: number,
  why: string,
) {
  const first =
    plan.lastExecutedPeriod === NO_PERIOD ? 0 : plan.lastExecutedPeriod + 1;
  const periods = Array.from({ length: count }, (_, i) => first + i);
  await sendAlert(deps.alerts, {
    kind: "installment_skipped",
    subject: `${address}:${periods.join(",")}`,
    title: `Plan ${address}: ${count} period${count === 1 ? "" : "s"} missed the catch-up window`,
    details: { periods: periods.join(", "), note: why, owner: plan.owner },
  });
}

async function runBatch(
  deps: ExecuteDeps,
  address: Address,
  plan: Plan,
  period: number,
  legMask: number,
  legIndexes: number[],
  now: bigint,
): Promise<string[]> {
  const send = {
    ...deps.send,
    rpc: deps.rpc,
    keeper: deps.keeper,
    log: deps.log,
  };
  const legs = await legInfos(deps.rpc, plan, legIndexes);
  const signatures: string[] = [];
  const setup = await missingAccounts(
    deps.rpc,
    deps.keeper,
    plan,
    deps.config,
    legs,
  );
  if (setup.length)
    signatures.push(
      (await sendInstructions(send, setup, "token accounts")).signature,
    );
  const updates = await freshUpdates(
    deps.hermes,
    [...new Set(legs.map((l) => l.feedId))],
    now,
    deps.config.maxOracleStalenessS,
  );
  const prices = await pricePlan(deps.rpc, deps.keeper, updates);
  for (const [i, group] of prices.transactions.entries())
    signatures.push(
      (
        await sendInstructions(
          send,
          group,
          `price ${i + 1}/${prices.transactions.length}`,
        )
      ).signature,
    );
  const execute = await executeInstruction({
    keeper: deps.keeper,
    planAddress: address,
    plan,
    config: deps.config,
    period,
    legMask,
    legs,
    priceUpdateFor: prices.priceUpdateFor,
  });
  const sent = await sendInstructions(send, [execute], "execute_installment");
  signatures.push(sent.signature);
  const event = installmentEvents(sent.logs).find(
    (e) => e.plan === address && e.period === period,
  );
  if (!event)
    throw new PermanentError(
      "execute_installment confirmed without its InstallmentExecuted event",
      sent.logs,
      "EVENT_MISSING",
    );
  const record = installmentRecord(event);
  await deps.db.insertInstallment({
    signature: sent.signature,
    wallet: plan.owner,
    amountIn: record.amountIn.toString(),
    mintIn: plan.fundingMint,
    legs: record.legs,
    slot: sent.slot,
    blockTime:
      sent.blockTime === null ? null : new Date(Number(sent.blockTime) * 1000),
    planPda: address,
    period,
  });
  // Rent back from the encoded VAA and price updates; a failure here never undoes the installment.
  try {
    signatures.push(
      (await sendInstructions(send, prices.cleanup, "cleanup")).signature,
    );
  } catch (err) {
    deps.log.warn(
      { err, plan: address, period },
      "price account cleanup failed; rent stays until the next cleanup",
    );
  }
  return signatures;
}
