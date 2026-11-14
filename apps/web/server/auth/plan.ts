import "server-only";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import {
  getAddressEncoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from "@solana/kit";
import { z } from "zod";
import { AppError } from "../errors";
import type { TradeKeyring } from "./trade";

/**
 * Plan authorizations (M7 B3): M4's `server/auth/trade` token pattern with its own purpose.
 *
 * Format `pa1.<kid>.<payload>.<mac>`. The MAC key is derived from the trade secret for this
 * purpose only (HMAC(secret, "aroma-plan-authorization-v1")), and the version prefix differs,
 * so a trade token can never pass as a plan token or the reverse. Key ids come from the same
 * keyring, so AROMA_TRADE_SECRET rotation (AROMA_TRADE_SECRET_PREVIOUS) covers both.
 *
 * At submit, the server requires the exact authorized message bytes back, signed by the bound
 * owner with a valid Ed25519 signature, and no other signer (AGENTS.md rules 1 and 2).
 */

export const PLAN_TOKEN_VERSION = "pa1";
const MAX_TOKEN_LENGTH = 4_096;
const MAX_TRANSACTION_BYTES = 1_232;
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const raw = z.string().regex(/^(0|[1-9]\d{0,19})$/);

export const planPayloadSchema = z
  .object({
    kind: z.enum(["plan_create", "plan_close"]),
    requestId: z.uuid(),
    owner: base58,
    plan: base58,
    cluster: z.enum(["devnet", "localnet"]),
    genesisHash: base58,
    /** Milliseconds since the epoch. */
    expiresAt: z.number().int().positive(),
    lastValidBlockHeight: z.string().regex(/^\d{1,20}$/),
    messageHash: z.string().regex(/^[0-9a-f]{64}$/),
    /** What the receipt records once confirmed (raw units). */
    receipt: z
      .object({
        fundingMint: base58,
        nonce: raw,
        installmentRaw: raw,
        periods: z.number().int().min(0).max(366),
        outputs: z
          .array(
            z.object({ mint: base58, weightBps: z.number().int() }).strict(),
          )
          .max(20),
      })
      .strict(),
  })
  .strict();
export type PlanPayload = z.infer<typeof planPayloadSchema>;

function purposeKey(secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("aroma-plan-authorization-v1")
    .digest();
}
const mac = (secret: string, signed: string) =>
  createHmac("sha256", purposeKey(secret)).update(signed).digest();

const invalid = (detail: string, cause?: unknown) =>
  new AppError("AUTHORIZATION_INVALID", { detail, cause });

export function sealPlanAuthorization(
  payload: PlanPayload,
  keyring: TradeKeyring,
): string {
  const checked = planPayloadSchema.parse(payload);
  const body = Buffer.from(JSON.stringify(checked)).toString("base64url");
  const signed = `${PLAN_TOKEN_VERSION}.${keyring.current.kid}.${body}`;
  return `${signed}.${mac(keyring.current.secret, signed).toString("base64url")}`;
}

export function openPlanAuthorization(
  token: unknown,
  keyring: TradeKeyring,
  options: { now?: number } = {},
): PlanPayload {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH)
    throw invalid("token missing or too long");
  const parts = token.split(".");
  if (parts.length !== 4) throw invalid("token shape");
  const [version, kid, body, received] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (version !== PLAN_TOKEN_VERSION) throw invalid("token version");
  const key =
    kid === keyring.current.kid
      ? keyring.current
      : kid === keyring.previous?.kid
        ? keyring.previous
        : null;
  if (!key) throw invalid("unknown key id");
  const expected = mac(key.secret, `${version}.${kid}.${body}`);
  const given = Buffer.from(received, "base64url");
  // One spelling per MAC: Node's decoder ignores the final character's padding bits and skips
  // characters outside the alphabet, so several strings decode to the same MAC. Accept only the
  // canonical one (what seal produced), so a token cannot be re-spelled and still verify.
  if (given.toString("base64url") !== received)
    throw invalid("mac not canonical");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw invalid("mac mismatch");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (cause) {
    throw invalid("payload is not JSON", cause);
  }
  const parsed = planPayloadSchema.safeParse(decoded);
  if (!parsed.success) throw invalid("payload schema", parsed.error);
  if (parsed.data.expiresAt <= (options.now ?? Date.now()))
    throw new AppError("QUOTE_EXPIRED", {
      publicMessage: "This review expired. Prepare the plan again.",
      detail: "plan authorization expired",
    });
  return parsed.data;
}

export const messageHash = (bytes: ArrayLike<number>) =>
  createHash("sha256").update(Uint8Array.from(bytes)).digest("hex");

type Decoded = {
  messageBytes: Uint8Array;
  signatures: Record<string, Uint8Array | null>;
  feePayer: string;
  signerCount: number;
};

/** Decode a base64 wire transaction (one signer slot per required signer). */
export function decodeWireTransaction(encoded: string): Decoded {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 2_000)
    throw new AppError("BAD_REQUEST", {
      publicMessage: "The transaction is malformed or too large.",
      detail: "transaction encoding or size",
    });
  try {
    const bytes = getBase64Encoder().encode(encoded);
    if (bytes.length > MAX_TRANSACTION_BYTES) throw new Error("oversized");
    const transaction = getTransactionDecoder().decode(bytes);
    const message = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
    const signatures: Record<string, Uint8Array | null> = {};
    for (const [address, signature] of Object.entries(transaction.signatures))
      signatures[address] = signature ? Uint8Array.from(signature) : null;
    return {
      messageBytes: Uint8Array.from(transaction.messageBytes),
      signatures,
      feePayer: message.staticAccounts[0] ?? "",
      signerCount: message.header.numSignerAccounts,
    };
  } catch (cause) {
    throw new AppError("BAD_REQUEST", {
      publicMessage: "The transaction could not be decoded.",
      detail: "transaction decode failed",
      cause,
    });
  }
}

/** The owner must be the only required signer and the fee payer. */
export function assertOwnerOnlySigner(decoded: Decoded, owner: string): void {
  const signers = Object.keys(decoded.signatures);
  if (
    decoded.signerCount !== 1 ||
    signers.length !== 1 ||
    signers[0] !== owner ||
    decoded.feePayer !== owner
  )
    throw new AppError("FORBIDDEN", {
      publicMessage:
        "Your wallet must be the only signer and fee payer of this transaction.",
      detail: "signer set or fee payer mismatch",
    });
}

/** Bind a freshly built, UNSIGNED transaction to its owner, purpose and expiry. */
export function authorizePlanTransaction(
  input: Omit<PlanPayload, "requestId" | "messageHash"> & {
    transaction: string;
  },
  keyring: TradeKeyring,
): { authorization: string; payload: PlanPayload } {
  const decoded = decodeWireTransaction(input.transaction);
  assertOwnerOnlySigner(decoded, input.owner);
  const { transaction: _transaction, ...rest } = input;
  const payload: PlanPayload = {
    ...rest,
    requestId: randomUUID(),
    messageHash: messageHash(decoded.messageBytes),
  };
  return { authorization: sealPlanAuthorization(payload, keyring), payload };
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Submit-time check: genuine, unexpired authorization; the signed transaction is the authorized
 * message byte for byte; the owner's Ed25519 signature over it is valid; nobody else signs.
 */
export function verifySignedPlanTransaction(
  authorization: unknown,
  signed: string,
  keyring: TradeKeyring,
  options: { now?: number } = {},
): { payload: PlanPayload; decoded: Decoded } {
  const payload = openPlanAuthorization(authorization, keyring, options);
  const decoded = decodeWireTransaction(signed);
  if (messageHash(decoded.messageBytes) !== payload.messageHash)
    throw new AppError("TRANSACTION_MISMATCH", {
      detail: "message differs from the authorized bytes",
    });
  assertOwnerOnlySigner(decoded, payload.owner);
  const signature = decoded.signatures[payload.owner] ?? null;
  const key = createPublicKey({
    key: Buffer.concat([
      ED25519_SPKI_PREFIX,
      Buffer.from(getAddressEncoder().encode(payload.owner as Address)),
    ]),
    format: "der",
    type: "spki",
  });
  if (
    !signature ||
    signature.length !== 64 ||
    signature.every((byte) => byte === 0) ||
    !verifySignature(
      null,
      Buffer.from(decoded.messageBytes),
      key,
      Buffer.from(signature),
    )
  )
    throw new AppError("SIGNATURE_INVALID", {
      detail: "owner signature invalid or missing",
    });
  return { payload, decoded };
}
