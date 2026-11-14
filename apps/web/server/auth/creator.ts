import { createHash, randomBytes } from "node:crypto";
import {
  address,
  getPublicKeyFromAddress,
  isAddress,
  isOffCurveAddress,
  type SignatureBytes,
  verifySignature,
} from "@solana/kit";
import { z } from "zod";
import { AppError } from "../errors";

/**
 * Creator authorization (ported from the prototype's lib/server/creator-auth.ts, REWRITE-PLAN
 * §5.2). The server never sees a key: it issues a challenge, the creator's wallet signs the
 * human-readable message, and the server verifies the Ed25519 signature against the wallet address.
 *
 * - The challenge payload is zod-parsed and stored in Redis under a random nonce, with a TTL.
 * - Verification consumes the nonce first (GETDEL), so a challenge works at most once, even under
 *   concurrent requests. A refused attempt burns it too; the client asks for a new one.
 * - The signed message embeds the SHA-256 of the canonical payload and of the content, so the
 *   signature covers exactly that wallet, purpose, basket, content, origin and time window.
 *
 * Errors are AppErrors with fixed public messages; `detail` (logs only) says which check failed.
 */

export const CHALLENGE_TTL_SECONDS = 300;
/** `redeem` is not in the plan's list: redeeming an invite also creates state for a wallet. */
export const CHALLENGE_PURPOSES = [
  "publish",
  "update",
  "delete",
  "redeem",
  // M9 compliance gate (additive): a wallet accepting a terms version (no basket, no funds).
  "terms",
] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

const PURPOSE_TITLE: Record<ChallengePurpose, string> = {
  publish: "publish a creator basket",
  update: "save a creator basket draft",
  delete: "archive a creator basket",
  redeem: "redeem a creator invite",
  terms: "accept Aroma's terms of use",
};

/** A base58 address that is on the Ed25519 curve, so it can sign (a PDA cannot). */
export const walletSchema = z
  .string()
  .trim()
  .max(44)
  .refine((value) => isAddress(value) && !isOffCurveAddress(address(value)), {
    message: "must be a wallet address",
  });

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const isoTime = z.iso.datetime();

export const challengePayloadSchema = z.strictObject({
  v: z.literal(1),
  origin: z.url(),
  wallet: walletSchema,
  purpose: z.enum(CHALLENGE_PURPOSES),
  basketId: z.uuid().nullable(),
  contentHash: hex64,
  nonce: nonceSchema,
  issuedAt: isoTime,
  expiresAt: isoTime,
});
export type ChallengePayload = z.infer<typeof challengePayloadSchema>;

/** The two Redis commands used (satisfied by @upstash/redis via `redisChallengeStore`). */
export type ChallengeStore = {
  set(
    key: string,
    value: string,
    options: { nx: true; ex: number },
  ): Promise<unknown>;
  getdel(key: string): Promise<unknown>;
};

const challengeKey = (nonce: string) => `creator:challenge:${nonce}`;

/** JSON with sorted object keys. Throws on values JSON cannot represent exactly. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError(`cannot canonicalise a ${typeof value}`);
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** SHA-256 (hex) of the canonical JSON of the request content (`null` for archive). */
export const contentHash = (content: unknown): string =>
  sha256(canonicalJson(content));
export const payloadHash = (payload: ChallengePayload): string =>
  sha256(canonicalJson(payload));

/**
 * The exact text the wallet shows and signs. `summary` lines describe the content for a human
 * (basket name, weights); the content itself is bound by its hash.
 */
export function challengeMessage(
  payload: ChallengePayload,
  summary: readonly string[],
): string {
  return [
    `Aroma: sign to ${PURPOSE_TITLE[payload.purpose]}`,
    `Site: ${payload.origin}`,
    `Wallet: ${payload.wallet}`,
    ...(payload.basketId ? [`Basket id: ${payload.basketId}`] : []),
    ...summary.map((line) => line.replace(/[\r\n]+/g, " ")),
    `Content: sha256:${payload.contentHash}`,
    `Request: sha256:${payloadHash(payload)}`,
    `Issued: ${payload.issuedAt}`,
    `Expires: ${payload.expiresAt}`,
    `Nonce: ${payload.nonce}`,
    "This signature only proves you control this wallet. It does not move funds or authorize trading.",
  ].join("\n");
}

export type ChallengeRequest = {
  origin: string;
  wallet: string;
  purpose: ChallengePurpose;
  basketId: string | null;
  /** Already validated by the caller's schema. Hashed canonically. */
  content: unknown;
  /**
   * Human-readable lines describing the content (basket name, weights). They must be derived
   * from `content` deterministically: verification rebuilds the message from them.
   */
  summary: readonly string[];
};

const issueInputSchema = z.object({
  origin: z.url(),
  wallet: walletSchema,
  purpose: z.enum(CHALLENGE_PURPOSES),
  basketId: z.uuid().nullable(),
});

export type IssuedChallenge = {
  payload: ChallengePayload;
  message: string;
};

export async function issueChallenge(
  store: ChallengeStore,
  input: ChallengeRequest,
  options: { now?: number } = {},
): Promise<IssuedChallenge> {
  const parsed = issueInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("VALIDATION_FAILED", {
      detail: "invalid challenge request",
    });
  const now = options.now ?? Date.now();
  const payload = challengePayloadSchema.parse({
    v: 1,
    ...parsed.data,
    contentHash: contentHash(input.content),
    nonce: randomBytes(24).toString("base64url"),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
  });
  const stored = await store.set(
    challengeKey(payload.nonce),
    canonicalJson(payload),
    { nx: true, ex: CHALLENGE_TTL_SECONDS },
  );
  if (stored !== "OK")
    throw new AppError("CONFLICT", { detail: "nonce-collision" });
  return { payload, message: challengeMessage(payload, input.summary) };
}

/** Decode a base64 Ed25519 signature; anything but exactly 64 bytes is refused. */
export function parseSignature(value: string): SignatureBytes {
  if (value.length > 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw refused("bad-signature-encoding");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value)
    throw refused("bad-signature-encoding");
  return new Uint8Array(bytes) as SignatureBytes;
}

const REFUSED_MESSAGE: Record<string, string> = {
  replay:
    "This approval was already used or has expired. Request a new one and sign again.",
  mismatch:
    "This approval does not match the request. Review it and sign again.",
  signature: "The signature does not match this wallet.",
};

function refused(detail: string): AppError {
  const kind =
    detail === "bad-signature" || detail === "bad-signature-encoding"
      ? "signature"
      : detail.startsWith("mismatch:")
        ? "mismatch"
        : "replay";
  return new AppError("UNAUTHORIZED", {
    publicMessage: REFUSED_MESSAGE[kind],
    detail,
  });
}

export type VerifyRequest = ChallengeRequest & {
  nonce: string;
  signature: string;
};

/**
 * Consume the nonce, then check the stored payload against the request and verify the signature
 * over the rebuilt message. Returns the payload on success; throws UNAUTHORIZED otherwise.
 */
export async function verifyChallenge(
  store: ChallengeStore,
  request: VerifyRequest,
  options: { now?: number } = {},
): Promise<ChallengePayload> {
  const now = options.now ?? Date.now();
  if (!nonceSchema.safeParse(request.nonce).success)
    throw refused("unknown-or-used-nonce");
  const raw = await store.getdel(challengeKey(request.nonce));
  if (typeof raw !== "string") throw refused("unknown-or-used-nonce");
  let payload: ChallengePayload;
  try {
    payload = challengePayloadSchema.parse(JSON.parse(raw));
  } catch {
    throw refused("corrupt-payload");
  }
  if (payload.nonce !== request.nonce) throw refused("corrupt-payload");

  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (now < issuedAt) throw refused("not-yet-valid");
  if (now >= expiresAt || expiresAt - issuedAt > CHALLENGE_TTL_SECONDS * 1000)
    throw refused("expired");

  if (payload.origin !== request.origin) throw refused("mismatch:origin");
  if (payload.wallet !== request.wallet) throw refused("mismatch:wallet");
  if (payload.purpose !== request.purpose) throw refused("mismatch:purpose");
  if (payload.basketId !== request.basketId) throw refused("mismatch:basketId");
  let submittedHash: string;
  try {
    submittedHash = contentHash(request.content);
  } catch {
    throw refused("mismatch:content");
  }
  if (payload.contentHash !== submittedHash) throw refused("mismatch:content");

  const signature = parseSignature(request.signature);
  const message = challengeMessage(payload, request.summary);
  const publicKey = await getPublicKeyFromAddress(address(payload.wallet));
  const valid = await verifySignature(
    publicKey,
    signature,
    new TextEncoder().encode(message),
  ).catch(() => false);
  if (!valid) throw refused("bad-signature");
  return payload;
}
