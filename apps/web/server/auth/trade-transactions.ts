import "server-only";
import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { getAddressEncoder, type Address } from "@solana/kit";
import { inspectWalletTransaction } from "@/lib/sdk/baskets/mainnet";
import {
  BASKET_MAX_ACCOUNTS,
  BASKET_MAX_TRANSACTIONS,
  MAX_BASKET_TRANSACTION_BASE64_LENGTH,
} from "@/lib/sdk/baskets/transaction-limits";
import { AppError } from "../errors";
import {
  openAuthorization,
  sealAuthorization,
  type TradeKeyring,
  type TradePayload,
  type TradeReceipt,
} from "./trade";

/**
 * Transaction checks for trade authorization, ported from bundle-authorization.ts and
 * composed-transactions.ts. The server never holds a key: it hashes the exact message bytes it
 * built, and at submit time requires the SAME bytes back with a valid Ed25519 signature from the
 * bound wallet, which must be the only signer and the fee payer.
 */

type Inspected = Awaited<ReturnType<typeof inspectWalletTransaction>>;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function messageHash(messageBytes: ArrayLike<number>): string {
  return createHash("sha256")
    .update(Uint8Array.from(messageBytes))
    .digest("hex");
}

/**
 * Decode a wallet transaction and enforce the runtime limits: v0 or v1 only, at most 64 accounts
 * including those loaded from lookup tables (ALTs compress bytes, not locks).
 */
export async function inspectTradeTransaction(
  encoded: unknown,
): Promise<Inspected & { version: 0 | 1 }> {
  if (
    typeof encoded !== "string" ||
    encoded.length > MAX_BASKET_TRANSACTION_BASE64_LENGTH ||
    !BASE64.test(encoded)
  )
    throw new AppError("BAD_REQUEST", {
      publicMessage: "A transaction is malformed or too large.",
      detail: "transaction encoding or size",
    });
  let inspected: Inspected;
  try {
    inspected = await inspectWalletTransaction(encoded);
  } catch (cause) {
    throw new AppError("BAD_REQUEST", {
      publicMessage: "A transaction could not be decoded.",
      detail: "transaction decode failed",
      cause,
    });
  }
  const version = inspected.message.version;
  if (version !== 0 && version !== 1)
    throw new AppError("WALLET_UNSUPPORTED", {
      detail: `transaction version ${String(version)}`,
    });
  let accounts = inspected.message.staticAccounts.length;
  if (version === 0) {
    const v0 = VersionedTransaction.deserialize(inspected.bytes).message;
    accounts += v0.addressTableLookups.reduce(
      (count, table) =>
        count + table.readonlyIndexes.length + table.writableIndexes.length,
      0,
    );
  }
  if (accounts > BASKET_MAX_ACCOUNTS)
    throw new AppError("BAD_REQUEST", {
      publicMessage: "A transaction exceeds the 64-account runtime limit.",
      detail: `${accounts} accounts`,
    });
  return { ...inspected, version };
}

/** The wallet must be the only required signer and the fee payer (first static account). */
function assertSoleSigner(inspected: Inspected, taker: string): void {
  const signers = Object.keys(inspected.transaction.signatures);
  if (
    signers.length !== 1 ||
    signers[0] !== taker ||
    inspected.message.staticAccounts[0] !== taker
  )
    throw new AppError("FORBIDDEN", {
      publicMessage:
        "The reviewed wallet must be the only signer and fee payer of every transaction.",
      detail: "signer set or fee payer mismatch",
    });
}

/**
 * Bind 1..5 freshly built, UNSIGNED transactions to a wallet, an expiry and a receipt. All must
 * share one version and be distinct. Returns the request id and the sealed authorization.
 */
export async function authorizeTransactions(
  input: {
    transactions: readonly string[];
    taker: string;
    expiresAt: number;
    lastValidBlockHeight: number;
    receipt: TradeReceipt;
  },
  keyring: TradeKeyring,
): Promise<{
  requestId: string;
  authorization: string;
  payload: TradePayload;
}> {
  if (
    input.transactions.length < 1 ||
    input.transactions.length > BASKET_MAX_TRANSACTIONS
  )
    throw new AppError("BAD_REQUEST", {
      publicMessage: "An order needs one to five transactions.",
      detail: `${input.transactions.length} transactions`,
    });
  const inspected = await Promise.all(
    input.transactions.map(inspectTradeTransaction),
  );
  for (const item of inspected) assertSoleSigner(item, input.taker);
  const transactionVersion = inspected[0]!.version;
  if (inspected.some((item) => item.version !== transactionVersion))
    throw new AppError("BAD_REQUEST", {
      publicMessage: "All transactions in an order must use the same version.",
      detail: "mixed versions",
    });
  const messageHashes = inspected.map((item) =>
    messageHash(item.transaction.messageBytes),
  );
  if (new Set(messageHashes).size !== messageHashes.length)
    throw new AppError("BAD_REQUEST", {
      publicMessage: "An order contains a duplicate transaction.",
      detail: "duplicate message",
    });
  const payload: TradePayload = {
    kind: "trade",
    requestId: randomUUID(),
    taker: input.taker,
    expiresAt: input.expiresAt,
    lastValidBlockHeight: input.lastValidBlockHeight,
    transactionVersion,
    messageHashes,
    receipt: input.receipt,
  };
  return {
    requestId: payload.requestId,
    authorization: sealAuthorization(payload, keyring),
    payload,
  };
}

function publicKeyOf(taker: string) {
  const raw = Buffer.from(getAddressEncoder().encode(taker as Address));
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * Submit-time check: the authorization is genuine and unexpired, the signed transactions are the
 * authorized messages byte for byte (same count, same order, same SHA-256), every one is signed by
 * the bound wallet with a valid Ed25519 signature, and nothing else signs.
 */
export async function verifySignedTransactions(
  authorization: unknown,
  signed: readonly unknown[],
  keyring: TradeKeyring,
  options: { now?: number; allowExpired?: boolean } = {},
): Promise<TradePayload> {
  const payload = openAuthorization(authorization, keyring, options);
  if (signed.length !== payload.messageHashes.length)
    throw new AppError("TRANSACTION_MISMATCH", {
      detail: `expected ${payload.messageHashes.length} transactions, got ${signed.length}`,
    });
  const key = publicKeyOf(payload.taker);
  const inspected = await Promise.all(signed.map(inspectTradeTransaction));
  inspected.forEach((item, index) => {
    if (item.version !== payload.transactionVersion)
      throw new AppError("TRANSACTION_MISMATCH", {
        detail: "transaction version differs",
      });
    if (
      messageHash(item.transaction.messageBytes) !==
      payload.messageHashes[index]
    )
      throw new AppError("TRANSACTION_MISMATCH", {
        detail: `message ${index} differs from the authorized bytes`,
      });
    assertSoleSigner(item, payload.taker);
    const signature =
      item.transaction.signatures[payload.taker as Address] ?? null;
    if (
      !signature ||
      signature.every((byte) => byte === 0) ||
      !verifySignature(
        null,
        Buffer.from(item.transaction.messageBytes),
        key,
        Buffer.from(signature),
      )
    )
      throw new AppError("SIGNATURE_INVALID", {
        detail: `signature ${index} invalid or missing`,
      });
  });
  return payload;
}
