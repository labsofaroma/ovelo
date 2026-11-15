import "server-only";
import type { Address, Base64EncodedWireTransaction } from "@solana/kit";
import {
  decodeOveloGuardEvents,
  indexRowFromPlan,
  planAddresses,
} from "@ovelo/guard";
import { verifySignedPlanTransaction } from "@/server/auth/plan";
import type { TradeKeyring } from "@/server/auth/trade";
import { AppError } from "@/server/errors";
import {
  idempotencyKey,
  withIdempotency,
  type LeaseRedis,
} from "@/server/lease";
import { logger } from "@/server/logger";
import type { SubmitRequest, SubmitResponse } from "../schema";
import { chainNow, readAccount, readMint, readPlan } from "./chain";
import type { InvestNetwork, InvestRpc } from "./cluster";
import { formatRaw } from "./format";
import type { InvestStore } from "./store";
import { sendAndConfirm, type Confirmed } from "./transactions";

/**
 * POST /api/v1/plans/submit (B3). The authorization and the signed bytes are verified first (M4
 * pattern); then the transaction is sent and confirmed, its v1 event is checked against the
 * authorization, and only then are `receipts` and `plans_index` written. Idempotent per request
 * id through Redis; the program is the final guard (a plan PDA can be created and closed once).
 */

export type SubmitDeps = {
  network: InvestNetwork;
  rpc: InvestRpc;
  keyring: TradeKeyring;
  store: InvestStore;
  redis: LeaseRedis;
  now?: () => number;
  confirm?: typeof sendAndConfirm;
};

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

export async function submitPlan(
  deps: SubmitDeps,
  body: SubmitRequest,
): Promise<SubmitResponse> {
  const { payload } = verifySignedPlanTransaction(
    body.authorization,
    body.transaction,
    deps.keyring,
    {
      now: (deps.now ?? Date.now)(),
    },
  );
  if (
    payload.cluster !== deps.network.cluster ||
    payload.genesisHash !== deps.network.deployment.genesisHash
  )
    throw new AppError("WRONG_CLUSTER", {
      publicMessage:
        "This plan was prepared for another network. Prepare it again here.",
      detail: `authorization for ${payload.cluster}`,
    });
  const { value } = await withIdempotency(
    deps.redis,
    idempotencyKey("plan-submit", payload.requestId),
    IDEMPOTENCY_TTL_SECONDS,
    async () => {
      const confirmed = await (deps.confirm ?? sendAndConfirm)(
        deps.rpc,
        body.transaction as Base64EncodedWireTransaction,
        BigInt(payload.lastValidBlockHeight),
      );
      return payload.kind === "plan_create"
        ? recordCreate(deps, payload, confirmed)
        : recordClose(deps, payload, confirmed);
    },
  );
  return value;
}

type Payload = ReturnType<typeof verifySignedPlanTransaction>["payload"];

function eventFor(
  programId: Address,
  confirmed: Confirmed,
  name: "PlanCreated" | "PlanClosed",
  payload: Payload,
) {
  const event = decodeOveloGuardEvents(confirmed.logs, programId).find(
    (e) =>
      e.name === name &&
      e.data.plan === payload.plan &&
      e.data.owner === payload.owner,
  );
  if (!event) {
    // Confirmed, but not the authorized effect: never record it as one.
    logger.error(
      { signature: confirmed.signature, plan: payload.plan, name },
      "invest event missing",
    );
    throw new AppError("TRANSACTION_FAILED", {
      detail: `${name} event missing`,
    });
  }
  return event;
}

async function recordCreate(
  deps: SubmitDeps,
  payload: Payload,
  confirmed: Confirmed,
): Promise<SubmitResponse> {
  eventFor(
    deps.network.deployment.programId,
    confirmed,
    "PlanCreated",
    payload,
  );
  const plan = payload.plan as Address;
  await deps.store.insertReceipt({
    signature: confirmed.signature,
    wallet: payload.owner,
    kind: "plan_create",
    amountIn: payload.receipt.installmentRaw,
    mintIn: payload.receipt.fundingMint,
    legs: payload.receipt.outputs,
    slot: confirmed.slot,
    blockTime:
      confirmed.blockTime === null
        ? null
        : new Date(Number(confirmed.blockTime) * 1000),
    planPda: plan,
    period: null,
    status: "confirmed",
  });
  const read = await readPlan(
    deps.rpc,
    deps.network.deployment.programId,
    plan,
  );
  if (read)
    await deps.store.upsertRows([
      indexRowFromPlan(plan, read.plan, await chainNow(deps.rpc)),
    ]);
  return {
    signature: confirmed.signature,
    plan,
    kind: "plan_create",
    status: "confirmed",
    slot: confirmed.slot?.toString() ?? null,
    result: ["Plan created and the recurring approval is in place."],
  };
}

async function recordClose(
  deps: SubmitDeps,
  payload: Payload,
  confirmed: Confirmed,
): Promise<SubmitResponse> {
  const event = eventFor(
    deps.network.deployment.programId,
    confirmed,
    "PlanClosed",
    payload,
  );
  if (event.name !== "PlanClosed")
    throw new AppError("INTERNAL", { detail: "event kind" });
  const plan = payload.plan as Address;
  const owner = payload.owner as Address;
  const fundingMint = payload.receipt.fundingMint as Address;
  const mint = await readMint(deps.rpc, fundingMint);
  const addresses = await planAddresses({
    owner,
    fundingMint,
    fundingTokenProgram: mint.tokenProgram,
    nonce: BigInt(payload.receipt.nonce),
  });
  // Read the result back from chain: the plan and its delegation must be gone.
  const [planAccount, delegation] = await Promise.all([
    readAccount(deps.rpc, plan),
    readAccount(deps.rpc, addresses.recurringDelegation),
  ]);
  await deps.store.insertReceipt({
    signature: confirmed.signature,
    wallet: owner,
    kind: "plan_close",
    amountIn: event.data.returnedAmount.toString(),
    mintIn: fundingMint,
    legs: [],
    slot: confirmed.slot,
    blockTime:
      confirmed.blockTime === null
        ? null
        : new Date(Number(confirmed.blockTime) * 1000),
    planPda: plan,
    period: null,
    status: "confirmed",
  });
  await deps.store.closeRows([plan]);
  const result = [
    planAccount === null
      ? "Plan closed: the plan account no longer exists."
      : "The plan account still exists on chain; refresh in a moment.",
    delegation === null
      ? "Recurring approval revoked: the delegation account no longer exists."
      : "The delegation account still exists on chain; refresh in a moment.",
    `Executed ${event.data.executedPeriods} installments, skipped ${event.data.skippedPeriods}.`,
  ];
  if (event.data.returnedAmount > 0n)
    result.push(
      `${formatRaw(event.data.returnedAmount, mint.decimals)} returned from staging to your wallet.`,
    );
  if (confirmed.feePayerDelta !== null && confirmed.feePayerDelta > 0n)
    result.push(
      `Rent returned to your wallet: ${formatRaw(confirmed.feePayerDelta, 9)} SOL net of the network fee.`,
    );
  return {
    signature: confirmed.signature,
    plan,
    kind: "plan_close",
    status: "confirmed",
    slot: confirmed.slot?.toString() ?? null,
    result,
  };
}
