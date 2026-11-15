import type { Address } from "@solana/kit";
import { findAssociatedTokenAddress, type Plan } from "@ovelo/guard";
import type { KeeperDb } from "./db";
import type { Logger } from "./log";
import type { KeeperRpc } from "./rpc";

/**
 * M11 user notifications from the DEVNET keeper (the web app delivers them; apps/web
 * features/notifications). The keeper writes one `notification_events` row in the same step as
 * the fact, only for an owner with an active subscription, with a deterministic id (a retried
 * run writes nothing new). Every event is labelled devnet. A failure here is logged and never
 * affects the installment.
 */
export type NotifyEvent = {
  id: string;
  wallet: string;
  kind: "plan_round_executed" | "plan_round_failed" | "plan_low_balance";
  payload: Record<string, unknown>;
};

async function record(db: KeeperDb, log: Logger, event: NotifyEvent) {
  try {
    await db.recordNotification(event);
  } catch (err) {
    log.warn({ err, event: event.id }, "notification event not recorded");
  }
}

/** The owner's funding balance (raw units and decimals); a missing account is 0, decimals null. */
async function fundingBalance(rpc: KeeperRpc, plan: Plan) {
  const ata = await findAssociatedTokenAddress(
    plan.owner,
    plan.fundingMint,
    plan.fundingTokenProgram,
  );
  try {
    const { value } = await rpc
      .getTokenAccountBalance(ata, { commitment: "confirmed" })
      .send();
    return {
      raw: BigInt(value.amount),
      decimals: value.decimals as number | null,
    };
  } catch {
    return { raw: 0n, decimals: null };
  }
}

/** After a round ran: "round ran", and "balance too low" when the next round cannot be paid. */
export async function notifyExecuted(
  deps: { rpc: KeeperRpc; db: KeeperDb; log: Logger },
  address: Address,
  plan: Plan,
  period: number,
  signature: string | undefined,
): Promise<void> {
  const balance = await fundingBalance(deps.rpc, plan);
  const base = {
    plan: address,
    mint: plan.fundingMint,
    ...(balance.decimals === null
      ? {}
      : { decimals: balance.decimals, symbol: "test tokens" }),
  };
  if (signature)
    await record(deps.db, deps.log, {
      id: `plan:${address}:${period}:executed`,
      wallet: plan.owner,
      kind: "plan_round_executed",
      payload: {
        ...base,
        period,
        signature,
        amountRaw: plan.fundingAmount.toString(),
      },
    });
  const remaining = plan.periods - plan.executedPeriods - plan.skippedPeriods;
  if (remaining > 0 && balance.raw < plan.fundingAmount)
    await record(deps.db, deps.log, {
      id: `plan:${address}:${period}:low-balance`,
      wallet: plan.owner,
      kind: "plan_low_balance",
      payload: {
        ...base,
        balanceRaw: balance.raw.toString(),
        neededRaw: plan.fundingAmount.toString(),
      },
    });
}

export function notifyFailed(
  deps: { db: KeeperDb; log: Logger },
  address: Address,
  owner: string,
  period: number,
  code: string,
): Promise<void> {
  return record(deps.db, deps.log, {
    id: `plan:${address}:${period}:failed`,
    wallet: owner,
    kind: "plan_round_failed",
    payload: { plan: address, period, code },
  });
}
