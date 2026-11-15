import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../errors";
import { tryGetEnv } from "../env";

/**
 * Trade authorization tokens (REWRITE-PLAN §5.2). Ported from the prototype's
 * trade-authorization.ts, bundle-authorization.ts and composed-transactions.ts (HMAC part), with:
 * - a zod-parsed payload (an unknown or malformed field is rejected, never cast);
 * - a key id, so OVELO_TRADE_SECRET can rotate while OVELO_TRADE_SECRET_PREVIOUS still verifies
 *   quotes issued before the switch (they expire within a minute anyway);
 * - expiry, wallet binding and a SHA-256 hash of every authorized message, in order.
 *
 * Format: `at1.<kid>.<payload base64url>.<HMAC-SHA256 base64url>`. The MAC covers the version,
 * the key id and the payload, so none of them can be swapped independently.
 */

export const TOKEN_VERSION = "at1";
const MAX_TOKEN_LENGTH = 4_096;
const U64_MAX = 2n ** 64n - 1n;

const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
/** A raw integer token amount that fits in a u64 (rule 5: never a float). */
export const rawAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,19})$/)
  // zod 4 still runs refinements after a failed regex, so guard before BigInt() (which throws).
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) <= U64_MAX,
    "exceeds u64",
  );

export const tradeReceiptSchema = z
  .object({
    kind: z.enum(["spot", "basket"]),
    /** Basket id for baskets (a curated slug or a creator basket UUID); null for a single stock. */
    basketId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .nullable(),
    /** Creator baskets only: the published version quoted (basket_versions), M5b B3. */
    basketVersion: z.number().int().positive().optional(),
    inputMint: base58,
    /** The maximum funding debit the user reviewed (raw units). */
    inAmount: rawAmountSchema,
    legs: z
      .array(
        z
          .object({
            mint: base58,
            /** The leg's exact input allocation (raw units of inputMint). */
            inputAmount: rawAmountSchema,
            outAmount: rawAmountSchema,
            minimumAmount: rawAmountSchema,
            /** Index of the transaction that carries this leg. */
            tx: z.number().int().min(0).max(4),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type TradeReceipt = z.infer<typeof tradeReceiptSchema>;

export const tradePayloadSchema = z
  .object({
    kind: z.literal("trade"),
    requestId: z.uuid(),
    taker: base58,
    /** Milliseconds since the epoch. */
    expiresAt: z.number().int().positive(),
    lastValidBlockHeight: z.number().int().positive(),
    transactionVersion: z.union([z.literal(0), z.literal(1)]),
    /** SHA-256 of each authorized message, in submission order. One entry: single transaction. */
    messageHashes: z.array(sha256Hex).min(1).max(5),
    receipt: tradeReceiptSchema,
  })
  .strict()
  .refine((p) => new Set(p.messageHashes).size === p.messageHashes.length, {
    message: "duplicate message",
  });
export type TradePayload = z.infer<typeof tradePayloadSchema>;

export type TradeKey = { kid: string; secret: string };
export type TradeKeyring = { current: TradeKey; previous: TradeKey | null };

/** A short public identifier of a secret. It reveals nothing usable about the secret. */
export function keyId(secret: string): string {
  return createHash("sha256")
    .update(`ovelo-trade-kid:${secret}`)
    .digest("base64url")
    .slice(0, 10);
}

export function createKeyring(
  current: string,
  previous?: string | null,
): TradeKeyring {
  if (current.length < 32)
    throw new AppError("TRADING_UNAVAILABLE", {
      detail: "OVELO_TRADE_SECRET is shorter than 32 characters",
    });
  if (previous && previous.length < 32)
    throw new AppError("TRADING_UNAVAILABLE", {
      detail: "OVELO_TRADE_SECRET_PREVIOUS is shorter than 32 characters",
    });
  return {
    current: { kid: keyId(current), secret: current },
    previous:
      previous && previous !== current
        ? { kid: keyId(previous), secret: previous }
        : null,
  };
}

/** The keyring from the validated environment. Missing secret: trading is unavailable. */
export function keyringFromEnv(): TradeKeyring {
  const result = tryGetEnv();
  const secret = result.ok ? result.env.server.OVELO_TRADE_SECRET : undefined;
  if (!result.ok || !secret)
    throw new AppError("TRADING_UNAVAILABLE", {
      detail: "OVELO_TRADE_SECRET is not configured",
    });
  return createKeyring(secret, result.env.server.OVELO_TRADE_SECRET_PREVIOUS);
}

function mac(secret: string, signed: string): Buffer {
  return createHmac("sha256", secret).update(signed).digest();
}

/** Serialize and MAC a payload with the CURRENT key. The payload is validated first. */
export function sealAuthorization(
  payload: TradePayload,
  keyring: TradeKeyring,
): string {
  const checked = tradePayloadSchema.parse(payload);
  const body = Buffer.from(JSON.stringify(checked)).toString("base64url");
  const signed = `${TOKEN_VERSION}.${keyring.current.kid}.${body}`;
  return `${signed}.${mac(keyring.current.secret, signed).toString("base64url")}`;
}

const invalid = (detail: string, cause?: unknown) =>
  new AppError("AUTHORIZATION_INVALID", { detail, cause });

/**
 * Verify the MAC (constant time, current or previous key by key id), then parse the payload.
 * Expiry is checked unless `allowExpired` (read-only recovery of an already-submitted trade).
 */
export function openAuthorization(
  token: unknown,
  keyring: TradeKeyring,
  options: { now?: number; allowExpired?: boolean } = {},
): TradePayload {
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
  if (version !== TOKEN_VERSION) throw invalid("token version");
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
  const parsed = tradePayloadSchema.safeParse(decoded);
  if (!parsed.success) throw invalid("payload schema", parsed.error);
  const now = options.now ?? Date.now();
  if (!options.allowExpired && parsed.data.expiresAt <= now)
    throw new AppError("QUOTE_EXPIRED", { detail: "authorization expired" });
  return parsed.data;
}
