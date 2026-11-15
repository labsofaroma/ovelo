import "server-only";
import { z } from "zod";
import {
  memoryChallengeStore,
  redisChallengeStore,
} from "@/features/creators/http";
import { base58Address } from "@/features/trade/schema";
import { localStores } from "@/features/trade/server/local";
import type { ChallengeStore } from "@/server/auth/creator";
import { requireRedis } from "@/server/redis";
import {
  issueWalletChallenge,
  verifyWalletChallenge,
  type WalletPurpose,
} from "@/server/wallet-challenge";
import { sealSession } from "@/server/wallet-session";

/**
 * Wallet sessions for read-only, wallet-private views (M11): the creator dashboard and the
 * portfolio CSV. One signature (single-use nonce) → a 15-minute `ws1` token for that scope only.
 */
export const SCOPES = {
  creator: {
    purpose: "creator-dashboard",
    summary: ["Read-only: your baskets' usage and history."],
  },
  portfolio: {
    purpose: "portfolio-export",
    summary: ["Read-only: a CSV of this wallet's Aroma orders and P&L."],
  },
} as const satisfies Record<
  string,
  { purpose: WalletPurpose; summary: readonly string[] }
>;
export type Scope = keyof typeof SCOPES;

const scope = z.enum(["creator", "portfolio"]);
export const sessionChallengeBodySchema = z.strictObject({
  scope,
  wallet: base58Address,
});
export const sessionOpenBodySchema = z.strictObject({
  scope,
  wallet: base58Address,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  signature: z.string().min(1).max(100),
});

export type SessionDeps = { challenges(): ChallengeStore; now(): Date };
const defaults: SessionDeps = {
  challenges: () =>
    localStores()
      ? memoryChallengeStore()
      : redisChallengeStore(requireRedis()),
  now: () => new Date(),
};
let overrides: Partial<SessionDeps> = {};
export const sessionDeps = (): SessionDeps => ({ ...defaults, ...overrides });
export function setSessionDepsForTests(next: Partial<SessionDeps>): void {
  overrides = next;
}

export function issueSessionChallenge(
  deps: SessionDeps,
  origin: string,
  body: { scope: Scope; wallet: string },
) {
  const { purpose, summary } = SCOPES[body.scope];
  return issueWalletChallenge(
    deps.challenges(),
    {
      origin,
      wallet: body.wallet,
      purpose,
      content: { scope: body.scope },
      summary,
    },
    deps.now().getTime(),
  );
}

export async function openScopedSession(
  deps: SessionDeps,
  origin: string,
  body: { scope: Scope; wallet: string; nonce: string; signature: string },
) {
  const { purpose, summary } = SCOPES[body.scope];
  const now = deps.now().getTime();
  await verifyWalletChallenge(
    deps.challenges(),
    {
      origin,
      wallet: body.wallet,
      purpose,
      content: { scope: body.scope },
      summary,
      nonce: body.nonce,
      signature: body.signature,
    },
    now,
  );
  return sealSession(body.scope, body.wallet, { now });
}
