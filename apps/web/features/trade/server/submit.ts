import "server-only";
import { walletTransactionSignature } from "@/lib/sdk/baskets/mainnet";
import { describeSimulationFailure } from "@/lib/sdk/core/errors";
import type { TradeKeyring, TradePayload } from "@/server/auth/trade";
import { verifySignedTransactions } from "@/server/auth/trade-transactions";
import { AppError, ERROR_CODES, mapError } from "@/server/errors";
import { logger } from "@/server/logger";
import { bundleStatus, sendJitoBundle, type JitoRpc } from "./bundle";
import { tradeEvent } from "@/server/telemetry";
import { assertMainnet, RpcError, type MainnetRpc } from "./rpc";
import { RpcUnavailable } from "./rpc-pool";
import {
  receiptRows,
  type ReceiptWriter,
  type TradeRecord,
  type TradeStore,
} from "./store";

/**
 * Submit (rewrite of trade/execute, transaction/execute and bundles/execute|status):
 * 1. verify the authorization and that the signed bytes are the authorized messages;
 * 2. claim the request id (idempotency): a replay returns the stored record, no rebroadcast;
 * 3. cluster, V1 activation and blockhash-height checks, all BEFORE any broadcast;
 * 4. derive every signature before sending, so a lost response still leaves recovery material;
 * 5. broadcast (single: sendTransaction with preflight; basket: one Jito bundle, never split).
 *    M9 failover: if the single send fails in TRANSPORT (never on a JSON-RPC refusal), the SAME
 *    signed bytes are re-sent to the other RPC endpoint (idempotent by signature; nothing is
 *    re-signed or rebuilt). After an uncertain first send, a refused re-send is "unknown", never
 *    "failed": the first one may have been broadcast;
 * 6. write pending receipts, then track confirmation. An acknowledged broadcast whose receipt
 *    cannot be read is "unknown", never "failed" and never a safe retry. Polling stops when the
 *    chain is past the blockhash's last valid height with no status: it can never land.
 */

export type SubmitDeps = {
  keyring: TradeKeyring;
  rpc: MainnetRpc;
  store: TradeStore;
  receipts: ReceiptWriter;
  jito: JitoRpc | null;
  v1Active: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  confirmAttempts?: number;
  /** The other RPC endpoint than the one `rpc` sent through (M9 failover); null if none. */
  resend?: () => MainnetRpc | null;
  /** A fresh RPC handle pinned to one endpoint, for one status poll (consistent reads). */
  reads?: () => MainnetRpc;
};

const SEND_OPTIONS = {
  encoding: "base64",
  skipPreflight: false,
  preflightCommitment: "confirmed",
  maxRetries: 2,
} as const;

const publicError = (code: keyof typeof ERROR_CODES, message?: string) => ({
  code,
  message: message ?? ERROR_CODES[code].message,
});

export async function submitTrade(
  input: { authorization: unknown; signedTransactions: readonly unknown[] },
  deps: SubmitDeps,
): Promise<TradeRecord> {
  const payload = await verifySignedTransactions(
    input.authorization,
    input.signedTransactions,
    deps.keyring,
  );
  const signed = input.signedTransactions as string[];
  const mode = signed.length > 1 ? "bundle" : "single";
  if (mode === "bundle" && !deps.jito)
    throw new AppError("BUNDLE_UNAVAILABLE", { detail: "Jito not configured" });
  const signatures = await Promise.all(signed.map(walletTransactionSignature));
  const now = new Date().toISOString();
  const record: TradeRecord = {
    id: payload.requestId,
    taker: payload.taker,
    mode,
    transactionVersion: payload.transactionVersion,
    signatures,
    bundleId: null,
    status: "submitting",
    lastValidBlockHeight: payload.lastValidBlockHeight,
    receipt: payload.receipt,
    submittedAt: now,
    updatedAt: now,
    slot: null,
    error: null,
  };
  const existing = await deps.store.claim(record);
  if (existing) {
    logger.info(
      { tradeId: existing.id },
      "trade submit replayed; not rebroadcast",
    );
    return existing;
  }
  try {
    await preflightChecks(payload, deps);
  } catch (error) {
    // Nothing was broadcast: record the refusal so a retry with the same quote is also refused.
    await save(deps, record, { status: "failed", error: mapError(error).body });
    throw error;
  }
  let sent = false;
  try {
    if (mode === "single") {
      sent = true;
      await sendSigned(signed[0]!, record.id, deps);
    } else {
      sent = true;
      record.bundleId = await sendJitoBundle(signed, deps.jito!);
    }
  } catch (error) {
    // An RPC *refusal* of sendTransaction (preflight) means it was not broadcast. Anything else
    // (transport, Jito ambiguity) may have been: unknown, keep the signatures.
    if (mode === "single" && error instanceof RpcError) {
      const data = error.data as
        { data?: { err?: unknown; logs?: unknown } } | undefined;
      return save(deps, record, {
        status: "failed",
        error: publicError(
          "SIMULATION_FAILED",
          describeSimulationFailure(data?.data?.err, data?.data?.logs),
        ),
      });
    }
    logger.warn(
      { tradeId: record.id, sent, err: error },
      "trade broadcast uncertain",
    );
    await deps.receipts.insertPending(receiptRows(record));
    return save(deps, record, { status: "unknown" });
  }
  await deps.receipts.insertPending(receiptRows(record));
  const pending = await save(deps, record, { status: "pending" });
  return track(pending, deps, deps.confirmAttempts ?? 8);
}

/**
 * sendTransaction of the exact signed string. Only a failover-worthy transport failure moves the
 * same string to the other endpoint; a JSON-RPC refusal is final and propagates as RpcError.
 */
async function sendSigned(
  signedTransaction: string,
  tradeId: string,
  deps: SubmitDeps,
): Promise<void> {
  try {
    await deps.rpc<string>("sendTransaction", [
      signedTransaction,
      SEND_OPTIONS,
    ]);
    return;
  } catch (error) {
    const other =
      error instanceof RpcUnavailable && error.failover
        ? deps.resend?.()
        : null;
    if (!other) throw error;
    tradeEvent("submit.resend", { tradeId }, "warning");
    try {
      await other<string>("sendTransaction", [signedTransaction, SEND_OPTIONS]);
    } catch (second) {
      // The first send may have reached the cluster, so a refusal here proves nothing: unknown.
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        detail: "re-send after an uncertain first send did not succeed",
        cause: second,
      });
    }
  }
}

async function preflightChecks(payload: TradePayload, deps: SubmitDeps) {
  await assertMainnet(deps.rpc);
  if (payload.transactionVersion === 1 && !(await deps.v1Active()))
    throw new AppError("WALLET_UNSUPPORTED", {
      detail: "V1 not active on the configured RPC",
    });
  const height = await deps.rpc<number>("getBlockHeight", [
    { commitment: "confirmed" },
  ]);
  if (height > payload.lastValidBlockHeight)
    throw new AppError("BLOCKHASH_EXPIRED", { detail: `height ${height}` });
}

async function save(
  deps: SubmitDeps,
  record: TradeRecord,
  change: Partial<TradeRecord>,
): Promise<TradeRecord> {
  const next = { ...record, ...change, updatedAt: new Date().toISOString() };
  await deps.store.save(next);
  return next;
}

/** Poll chain status a few times; leave "pending" for GET /api/v1/trade/:id to finish. */
async function track(
  record: TradeRecord,
  deps: SubmitDeps,
  attempts: number,
): Promise<TradeRecord> {
  let current = record;
  for (let attempt = 0; attempt < attempts; attempt++) {
    current = await refresh(current, deps);
    if (current.status !== "pending") return current;
    if (attempt < attempts - 1) await deps.sleep(1200);
  }
  return current;
}

async function refresh(
  record: TradeRecord,
  deps: SubmitDeps,
): Promise<TradeRecord> {
  // Statuses and block height must come from one node: a lagging node next to a leading one
  // could otherwise make a landed transaction look expired.
  const rpc = deps.reads?.() ?? deps.rpc;
  if (record.mode === "bundle") {
    const result = await bundleStatus(
      {
        signatures: record.signatures,
        lastValidBlockHeight: record.lastValidBlockHeight,
        bundleId: record.bundleId,
      },
      { rpc, jito: deps.jito },
    ).catch(() => ({ status: "unknown" as const, slot: null }));
    if (result.status === "confirmed")
      return confirm(record, deps, result.slot, rpc);
    return result.status === record.status
      ? record
      : save(deps, record, { status: result.status });
  }
  let state: {
    err: unknown;
    confirmationStatus: string | null;
    slot: number;
  } | null;
  try {
    const statuses = await rpc<{
      value: ({
        err: unknown;
        confirmationStatus: string | null;
        slot: number;
      } | null)[];
    }>("getSignatureStatuses", [
      record.signatures,
      { searchTransactionHistory: true },
    ]);
    state = statuses.value?.[0] ?? null;
    if (state === null && (await expired(record, rpc))) {
      await deps.receipts.mark(record.signatures, {
        status: "failed",
        slot: null,
        blockTime: null,
      });
      return save(deps, record, {
        status: "failed",
        error: publicError("BLOCKHASH_EXPIRED"),
      });
    }
  } catch {
    return record.status === "unknown"
      ? record
      : save(deps, record, { status: "unknown" });
  }
  if (state?.err) {
    await deps.receipts.mark(record.signatures, {
      status: "failed",
      slot: BigInt(state.slot),
      blockTime: null,
    });
    return save(deps, record, {
      status: "failed",
      slot: state.slot,
      error: publicError("TRANSACTION_FAILED"),
    });
  }
  if (
    state &&
    ["confirmed", "finalized"].includes(state.confirmationStatus ?? "")
  )
    return confirm(record, deps, state.slot, rpc);
  return record;
}

/**
 * Block heights past `lastValidBlockHeight` during which a missing status still proves the
 * transaction never landed: every node keeps signatures of recent blockhashes in its in-memory
 * status cache (about 300 slots), so one that is past the expiry and has no status saw none.
 * Later, a null may only mean the node lacks history (or a history lookup failed silently), so
 * the record keeps its status: never "failed" from an absence of evidence.
 */
export const EXPIRY_DECISION_WINDOW = 150;

/** No status, and the chain (finalized) is just past the last valid height: it never lands. */
async function expired(record: TradeRecord, rpc: MainnetRpc): Promise<boolean> {
  const height = await rpc<number>("getBlockHeight", [
    { commitment: "finalized" },
  ]);
  return (
    height > record.lastValidBlockHeight &&
    height <= record.lastValidBlockHeight + EXPIRY_DECISION_WINDOW
  );
}

async function confirm(
  record: TradeRecord,
  deps: SubmitDeps,
  slot: number | null,
  rpc: MainnetRpc,
): Promise<TradeRecord> {
  let blockTime: Date | null = null;
  if (slot !== null) {
    const seconds = await rpc<number | null>("getBlockTime", [slot]).catch(
      () => null,
    );
    blockTime = typeof seconds === "number" ? new Date(seconds * 1000) : null;
  }
  await deps.receipts.mark(record.signatures, {
    status: "confirmed",
    slot: slot === null ? null : BigInt(slot),
    blockTime,
  });
  return save(deps, record, { status: "confirmed", slot, error: null });
}

/** GET /api/v1/trade/:id: the stored record, refreshed from chain while not final. */
export async function getTrade(
  id: string,
  deps: SubmitDeps,
): Promise<TradeRecord | null> {
  const record = await deps.store.get(id);
  if (!record) return null;
  if (record.status === "confirmed" || record.status === "failed")
    return record;
  if (record.status === "submitting") return record;
  return refresh(record, deps);
}
