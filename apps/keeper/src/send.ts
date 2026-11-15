import {
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type AddressesByLookupTableAddress,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { computeBudgetInstructions } from "@ovelo/guard/pyth";
import type { Logger } from "./log";
import type { KeeperRpc } from "./rpc";

/**
 * One keeper transaction: build (fee payer = keeper, compute budget from a simulation), sign with
 * the signers embedded in the instructions, SIMULATE, send, confirm. Transient failures (RPC,
 * expired blockhash, timeouts) retry with exponential backoff; a program error in simulation is
 * permanent (retrying the same bytes cannot help). Every retry rebuilds with a new blockhash, and
 * the program's period/leg bitmap makes a duplicate landing impossible.
 */

export class PermanentError extends Error {
  constructor(
    message: string,
    readonly logs: string[] = [],
    readonly code = "PROGRAM_ERROR",
  ) {
    super(message);
    this.name = "PermanentError";
  }
}

export type Sent = {
  signature: Signature;
  logs: string[];
  slot: bigint | null;
  blockTime: bigint | null;
  unitsConsumed: bigint | null;
};

export type SendDeps = {
  rpc: KeeperRpc;
  keeper: KeyPairSigner;
  log: Logger;
  priorityMicroLamports: bigint;
  maxAttempts: number;
  /** Base delay (ms) for backoff: base × 2^attempt plus jitter. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  confirmTimeoutMs?: number;
};

const json = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
const MAX_UNITS = 1_400_000;
/** Solana's packet limit for one serialized transaction. */
export const MAX_TRANSACTION_BYTES = 1_232;

/**
 * Mainnet (M8): verified address lookup tables to compress the message with, and an optional
 * submit path (Jito block engine) used instead of `sendTransaction` on the RPC. Simulation and
 * confirmation always go through the genesis-checked RPC.
 */
export type SendOptions = {
  lookupTables?: AddressesByLookupTableAddress;
  submit?: (wireBase64: string) => Promise<Signature>;
};

async function build(
  deps: SendDeps,
  instructions: readonly Instruction[],
  units: number,
  options: SendOptions = {},
) {
  const { value: blockhash } = await deps.rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(deps.keeper, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          ...computeBudgetInstructions(units, deps.priorityMicroLamports),
          ...instructions,
        ],
        m,
      ),
  );
  const compressed = options.lookupTables
    ? compressTransactionMessageUsingAddressLookupTables(
        message,
        options.lookupTables,
      )
    : message;
  const signed = await signTransactionMessageWithSigners(compressed);
  return {
    signed,
    wire: getBase64EncodedWireTransaction(signed),
    lastValid: blockhash.lastValidBlockHeight,
  };
}

async function simulateUnits(
  deps: SendDeps,
  wire: string,
  label: string,
): Promise<bigint | null> {
  const { value } = await deps.rpc
    .simulateTransaction(wire as never, {
      encoding: "base64",
      sigVerify: true,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    })
    .send();
  if (value.err) {
    const logs = [...(value.logs ?? [])];
    const blockhash = json(value.err).includes("BlockhashNotFound");
    if (blockhash)
      throw new Error(`${label}: blockhash not found in simulation`);
    throw new PermanentError(
      `${label}: simulation failed ${json(value.err)}`,
      logs,
    );
  }
  return value.unitsConsumed ?? null;
}

async function confirm(
  deps: SendDeps,
  signature: Signature,
  lastValid: bigint,
  label: string,
): Promise<void> {
  const deadline = Date.now() + (deps.confirmTimeoutMs ?? 60_000);
  for (;;) {
    const { value } = await deps.rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err)
      throw new PermanentError(`${label}: failed on chain ${json(status.err)}`);
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return;
    const height = await deps.rpc
      .getBlockHeight({ commitment: "confirmed" })
      .send();
    if (height > lastValid || Date.now() > deadline)
      throw new Error(`${label}: not confirmed before the blockhash expired`);
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(500);
  }
}

/** Serialized size of the transaction these instructions make (with any lookup tables). */
export async function transactionBytes(
  deps: SendDeps,
  instructions: readonly Instruction[],
  options: SendOptions = {},
): Promise<number> {
  const built = await build(deps, instructions, MAX_UNITS, options);
  return Buffer.from(built.wire, "base64").length;
}

export async function sendInstructions(
  deps: SendDeps,
  instructions: readonly Instruction[],
  label: string,
  options: SendOptions = {},
): Promise<Sent> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < deps.maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delay =
        (deps.backoffMs ?? 500) * 2 ** (attempt - 1) +
        Math.floor(Math.random() * 100);
      deps.log.info({ label, attempt, delay }, "retrying keeper transaction");
      await sleep(delay);
    }
    try {
      const probe = await build(deps, instructions, MAX_UNITS, options);
      const consumed = await simulateUnits(deps, probe.wire, label);
      const units = consumed
        ? Math.min(MAX_UNITS, Math.ceil(Number(consumed) * 1.15) + 5_000)
        : MAX_UNITS;
      const final = await build(deps, instructions, units, options);
      const signature = options.submit
        ? await options.submit(final.wire)
        : await deps.rpc
            .sendTransaction(final.wire, {
              encoding: "base64",
              skipPreflight: true,
            })
            .send();
      if (signature !== getSignatureFromTransaction(final.signed))
        throw new Error(`${label}: RPC returned another signature`);
      await confirm(deps, signature, final.lastValid, label);
      const tx = await deps.rpc
        .getTransaction(signature, {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      return {
        signature,
        logs: [...(tx?.meta?.logMessages ?? [])],
        slot: tx?.slot ?? null,
        blockTime:
          tx?.blockTime === null || tx?.blockTime === undefined
            ? null
            : BigInt(tx.blockTime),
        unitsConsumed: consumed,
      };
    } catch (error) {
      if (error instanceof PermanentError) throw error;
      lastError = error;
      deps.log.warn(
        { label, attempt, err: error },
        "keeper transaction attempt failed",
      );
    }
  }
  throw new RetriesExhausted(label, deps.maxAttempts, lastError);
}

export class RetriesExhausted extends Error {
  constructor(
    readonly label: string,
    readonly attempts: number,
    readonly last: unknown,
  ) {
    super(
      `${label}: ${attempts} attempts failed (${last instanceof Error ? last.message : String(last)})`,
    );
    this.name = "RetriesExhausted";
  }
}
