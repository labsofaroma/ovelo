import "server-only";
import {
  compileTransaction,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type Signature,
} from "@solana/kit";
import { singleTransactionMessage } from "@aroma/guard";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { InvestRpc } from "./cluster";

/**
 * Build, simulate, send and confirm the invest transactions. The server never signs (AGENTS.md
 * rule 1): the owner is a no-op signer here, so the wire transaction carries an empty signature
 * slot for the wallet to fill.
 */

/** JSON for logs and error details; kit returns RPC integers as bigint. */
export const safeJson = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );

export type UnsignedTransaction = {
  transaction: Base64EncodedWireTransaction;
  lastValidBlockHeight: bigint;
};

export async function buildUnsigned(
  rpc: InvestRpc,
  owner: Address,
  instructions: Instruction[],
): Promise<UnsignedTransaction> {
  const { value } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const message = singleTransactionMessage(
    createNoopSigner(owner),
    value,
    instructions,
  );
  const compiled = compileTransaction(message);
  return {
    transaction: getBase64EncodedWireTransaction(compiled),
    lastValidBlockHeight: value.lastValidBlockHeight,
  };
}

/** Simulate exactly the bytes the wallet will sign; a failure is never returned for signing. */
export async function simulate(
  rpc: InvestRpc,
  transaction: Base64EncodedWireTransaction,
  context: Record<string, unknown>,
): Promise<{ unitsConsumed: bigint | null }> {
  const { value } = await rpc
    .simulateTransaction(transaction, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    })
    .send();
  if (value.err) {
    logger.warn(
      { ...context, err: safeJson(value.err), logs: value.logs?.slice(-12) },
      "invest simulation failed",
    );
    throw new AppError("SIMULATION_FAILED", {
      publicMessage: simulationMessage(value.logs ?? []),
      detail: "invest transaction simulation failed",
    });
  }
  return { unitsConsumed: value.unitsConsumed ?? null };
}

/** A short, safe explanation for the common refusals (program logs never reach the client). */
export function simulationMessage(logs: readonly string[]): string {
  const text = logs.join("\n");
  if (/insufficient (funds|lamports)/i.test(text))
    return "Your wallet needs a little devnet SOL for fees and account rent. Use the faucet first.";
  if (
    /AccountNotInitialized|could not find account|InvalidAccountData/i.test(
      text,
    )
  )
    return "Your wallet has no test USD account yet. Use the faucet first.";
  return "The transaction would fail on devnet, so nothing was prepared for signing.";
}

export type Confirmed = {
  signature: Signature;
  slot: bigint | null;
  blockTime: bigint | null;
  logs: string[];
  /** Fee payer's lamports before and after (index 0), from the confirmed transaction's meta. */
  feePayerDelta: bigint | null;
};

/**
 * Send a signed transaction and wait for `confirmed`, or until its blockhash expires. An on-chain
 * error is TRANSACTION_FAILED (state rolled back); an expiry is BLOCKHASH_EXPIRED.
 */
export async function sendAndConfirm(
  rpc: InvestRpc,
  signed: Base64EncodedWireTransaction,
  lastValidBlockHeight: bigint,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<Confirmed> {
  const poll = options.pollMs ?? 800;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const signature = await rpc
    .sendTransaction(signed, {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send()
    .catch((cause: unknown) => {
      throw new AppError("TRANSACTION_FAILED", {
        detail: "sendTransaction rejected",
        cause,
      });
    });
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err)
      throw new AppError("TRANSACTION_FAILED", {
        detail: `on-chain error ${safeJson(status.err)}`,
      });
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      const tx = await rpc
        .getTransaction(signature, {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      return {
        signature,
        slot: tx?.slot ?? status.slot ?? null,
        blockTime:
          tx?.blockTime === null || tx?.blockTime === undefined
            ? null
            : BigInt(tx.blockTime),
        logs: [...(tx?.meta?.logMessages ?? [])],
        feePayerDelta:
          tx?.meta?.preBalances?.[0] !== undefined &&
          tx.meta.postBalances?.[0] !== undefined
            ? BigInt(tx.meta.postBalances[0]) - BigInt(tx.meta.preBalances[0])
            : null,
      };
    }
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (height > lastValidBlockHeight || Date.now() > deadline)
      throw new AppError("BLOCKHASH_EXPIRED", {
        detail: "not confirmed before the blockhash expired",
      });
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

export { getSignatureFromTransaction };
