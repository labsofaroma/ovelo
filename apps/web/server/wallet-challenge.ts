import "server-only";
import { randomBytes } from "node:crypto";
import { address, getPublicKeyFromAddress, verifySignature } from "@solana/kit";
import { z } from "zod";
import {
  CHALLENGE_TTL_SECONDS,
  canonicalJson,
  contentHash,
  parseSignature,
  walletSchema,
  type ChallengeStore,
} from "./auth/creator";
import { AppError } from "./errors";

/**
 * M11 wallet-signed requests that are not about a basket: opening notification settings, opting a
 * channel in, opening the creator dashboard. The same rules as the M5 creator challenge
 * (server/auth/creator.ts, which stays frozen; only its exports are reused):
 * - a 5-minute, single-use nonce in Redis (`SET NX EX`), consumed with GETDEL before anything
 *   else, so a signature works at most once;
 * - the signed text names the site, the wallet, the purpose and the SHA-256 of the content;
 * - a refusal never says more than "sign again"; `detail` (logs only) says which check failed.
 */
export const WALLET_PURPOSES = [
  "notify-manage",
  "notify-subscribe",
  "creator-dashboard",
  "portfolio-export",
] as const;
export type WalletPurpose = (typeof WALLET_PURPOSES)[number];

const TITLE: Record<WalletPurpose, string> = {
  "notify-manage": "open your Ovelo notification settings",
  "notify-subscribe": "turn on an Ovelo notification channel",
  "creator-dashboard": "open your Ovelo creator dashboard",
  "portfolio-export": "download your Ovelo portfolio history",
};

const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const payloadSchema = z.strictObject({
  v: z.literal(1),
  origin: z.url(),
  wallet: walletSchema,
  purpose: z.enum(WALLET_PURPOSES),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: nonceSchema,
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
type Payload = z.infer<typeof payloadSchema>;

const key = (nonce: string) => `wallet:challenge:${nonce}`;

export function walletChallengeMessage(
  payload: Payload,
  summary: readonly string[],
): string {
  return [
    `${new URL(payload.origin).host} asks you to ${TITLE[payload.purpose]}.`,
    "",
    ...summary,
    "",
    "This signature does not move funds or approve a transaction.",
    "",
    `Wallet: ${payload.wallet}`,
    `Content: sha256:${payload.contentHash}`,
    `Nonce: ${payload.nonce}`,
    `Issued: ${payload.issuedAt}`,
    `Expires: ${payload.expiresAt}`,
  ].join("\n");
}

export type WalletChallengeInput = {
  origin: string;
  wallet: string;
  purpose: WalletPurpose;
  content: unknown;
  summary: readonly string[];
};

export async function issueWalletChallenge(
  store: ChallengeStore,
  input: WalletChallengeInput,
  now: number = Date.now(),
): Promise<{ nonce: string; message: string; expiresAt: string }> {
  if (!walletSchema.safeParse(input.wallet).success)
    throw new AppError("VALIDATION_FAILED", { detail: "challenge: wallet" });
  const payload = payloadSchema.parse({
    v: 1,
    origin: input.origin,
    wallet: input.wallet,
    purpose: input.purpose,
    contentHash: contentHash(input.content),
    nonce: randomBytes(24).toString("base64url"),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
  });
  const stored = await store.set(key(payload.nonce), canonicalJson(payload), {
    nx: true,
    ex: CHALLENGE_TTL_SECONDS,
  });
  if (stored !== "OK")
    throw new AppError("CONFLICT", { detail: "nonce-collision" });
  return {
    nonce: payload.nonce,
    message: walletChallengeMessage(payload, input.summary),
    expiresAt: payload.expiresAt,
  };
}

const refused = (detail: string) =>
  new AppError("UNAUTHORIZED", {
    publicMessage:
      detail === "bad-signature"
        ? "The signature does not match this wallet."
        : "This approval was already used, has expired or does not match. Sign again.",
    detail,
  });

/** Consume the nonce, check it against the request, verify the Ed25519 signature. */
export async function verifyWalletChallenge(
  store: ChallengeStore,
  input: WalletChallengeInput & { nonce: string; signature: string },
  now: number = Date.now(),
): Promise<void> {
  if (!nonceSchema.safeParse(input.nonce).success)
    throw refused("unknown-or-used-nonce");
  const raw = await store.getdel(key(input.nonce));
  if (typeof raw !== "string") throw refused("unknown-or-used-nonce");
  let payload: Payload;
  try {
    payload = payloadSchema.parse(JSON.parse(raw));
  } catch {
    throw refused("corrupt-payload");
  }
  const issued = Date.parse(payload.issuedAt);
  const expires = Date.parse(payload.expiresAt);
  if (now < issued || now >= expires) throw refused("expired");
  if (payload.nonce !== input.nonce) throw refused("corrupt-payload");
  if (payload.origin !== input.origin) throw refused("mismatch:origin");
  if (payload.wallet !== input.wallet) throw refused("mismatch:wallet");
  if (payload.purpose !== input.purpose) throw refused("mismatch:purpose");
  let hash: string;
  try {
    hash = contentHash(input.content);
  } catch {
    throw refused("mismatch:content");
  }
  if (payload.contentHash !== hash) throw refused("mismatch:content");
  const signature = (() => {
    try {
      return parseSignature(input.signature);
    } catch {
      throw refused("bad-signature");
    }
  })();
  const message = walletChallengeMessage(payload, input.summary);
  const publicKey = await getPublicKeyFromAddress(address(payload.wallet));
  const valid = await verifySignature(
    publicKey,
    signature,
    new TextEncoder().encode(message),
  ).catch(() => false);
  if (!valid) throw refused("bad-signature");
}
