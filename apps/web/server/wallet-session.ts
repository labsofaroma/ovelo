import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { keyringFromEnv, type TradeKeyring } from "./auth/trade";
import { walletSchema } from "./auth/creator";
import { AppError } from "./errors";

/**
 * M11 short-lived wallet sessions: after the wallet signs a single-use challenge
 * (server/wallet-challenge.ts), the server hands back an HMAC token bound to that wallet and one
 * scope, for reads and small changes that should not each need a new signature (notification
 * settings, the creator dashboard). Format: `ws1.<scope>.<kid>.<body>.<mac>`.
 *
 * The key is derived from the trade secret per scope (`HMAC(secret, "ovelo:ws1:<scope>")`), so a
 * session token can never be confused with a trade authorization or used for another scope, and
 * rotating OVELO_TRADE_SECRET (with _PREVIOUS) rotates these too. No cookie: the client keeps
 * the token in memory and sends it as `Authorization: Bearer`.
 */
export const SESSION_SCOPES = ["notify", "creator", "portfolio"] as const;
export type SessionScope = (typeof SESSION_SCOPES)[number];
export const SESSION_TTL_SECONDS = 15 * 60;

const bodySchema = z.strictObject({
  wallet: walletSchema,
  exp: z.number().int().positive(),
});

const derive = (secret: string, scope: SessionScope) =>
  createHmac("sha256", secret).update(`ovelo:ws1:${scope}`).digest();
const mac = (key: Buffer, signed: string) =>
  createHmac("sha256", key).update(signed).digest();

export function sealSession(
  scope: SessionScope,
  wallet: string,
  options: { now?: number; keyring?: TradeKeyring } = {},
): { token: string; expiresAt: string } {
  const keyring = options.keyring ?? keyringFromEnv();
  const exp =
    Math.floor((options.now ?? Date.now()) / 1000) + SESSION_TTL_SECONDS;
  const body = Buffer.from(JSON.stringify({ wallet, exp })).toString(
    "base64url",
  );
  const signed = `ws1.${scope}.${keyring.current.kid}.${body}`;
  const tag = mac(derive(keyring.current.secret, scope), signed);
  return {
    token: `${signed}.${tag.toString("base64url")}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

const unauthorized = (detail: string) =>
  new AppError("UNAUTHORIZED", {
    publicMessage: "Your session has ended. Sign in with your wallet again.",
    detail,
  });

/** The wallet a valid `Authorization: Bearer ws1…` header for `scope` belongs to. */
export function openSession(
  scope: SessionScope,
  authorization: string | null,
  options: { now?: number; keyring?: TradeKeyring } = {},
): string {
  const token = authorization?.match(
    /^Bearer (ws1\.[A-Za-z0-9._-]{1,600})$/,
  )?.[1];
  if (!token) throw unauthorized("session:missing");
  const parts = token.split(".");
  if (parts.length !== 5) throw unauthorized("session:shape");
  const [, tokenScope, kid, body, tag] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (tokenScope !== scope) throw unauthorized("session:scope");
  const keyring = options.keyring ?? keyringFromEnv();
  const key =
    kid === keyring.current.kid
      ? keyring.current
      : kid === keyring.previous?.kid
        ? keyring.previous
        : null;
  if (!key) throw unauthorized("session:kid");
  const expected = mac(
    derive(key.secret, scope),
    `ws1.${tokenScope}.${kid}.${body}`,
  );
  const given = Buffer.from(tag, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw unauthorized("session:mac");
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    throw unauthorized("session:body");
  }
  if (parsed.exp * 1000 <= (options.now ?? Date.now()))
    throw unauthorized("session:expired");
  return parsed.wallet;
}
