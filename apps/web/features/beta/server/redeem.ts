import "server-only";
import { issueChallenge, verifyChallenge } from "@/server/auth/creator";
import type { BetaDeps } from "./deps";
import { betaCodeSchema, hashBetaCode, redeemBetaInvite } from "./invites";
import { AppError } from "@/server/errors";

/**
 * Wallet-signed invite redemption (REWRITE-PLAN §7.3 W2), the M5 challenge pattern with purpose
 * `beta`: the server issues a 5-minute single-use nonce bound to the site, the wallet and the
 * SHA-256 of the code; the wallet signs the message (signMessage); the server consumes the nonce
 * (GETDEL), verifies the Ed25519 signature and only then redeems the code atomically. A
 * signature can therefore not be replayed, moved to another wallet or used with another code.
 */
function signed(code: string) {
  const parsed = betaCodeSchema.safeParse(code);
  if (!parsed.success)
    throw new AppError("BETA_INVITE_INVALID", {
      detail: "beta-invite:malformed",
    });
  return {
    content: { codeHash: hashBetaCode(parsed.data) },
    summary: [
      "Private beta invite (the code itself is not shown)",
      "This signature does not move funds.",
    ],
  };
}

export async function issueBetaChallenge(
  deps: BetaDeps,
  input: { origin: string; wallet: string; code: string },
) {
  const { payload, message } = await issueChallenge(
    deps.challenges(),
    {
      origin: input.origin,
      wallet: input.wallet,
      purpose: "beta",
      basketId: null,
      ...signed(input.code),
    },
    { now: deps.now().getTime() },
  );
  return { nonce: payload.nonce, message, expiresAt: payload.expiresAt };
}

export async function redeemBeta(
  deps: BetaDeps,
  input: {
    origin: string;
    wallet: string;
    code: string;
    nonce: string;
    signature: string;
  },
) {
  await verifyChallenge(
    deps.challenges(),
    {
      origin: input.origin,
      wallet: input.wallet,
      purpose: "beta",
      basketId: null,
      ...signed(input.code),
      nonce: input.nonce,
      signature: input.signature,
    },
    { now: deps.now().getTime() },
  );
  const result = await redeemBetaInvite(deps.db(), {
    code: input.code,
    wallet: input.wallet,
    now: deps.now(),
  });
  return { access: true as const, alreadyHadAccess: result.alreadyHadAccess };
}
