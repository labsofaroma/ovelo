import "server-only";
import type { TermsDeps } from "@/features/compliance/server/terms";
import { assertTermsAccepted } from "@/features/compliance/server/terms";
import { assertJurisdiction } from "@/features/compliance/server/gate";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { BetaDeps } from "./deps";
import { hasBetaAccess } from "./invites";

/**
 * Route-level private-beta checks (REWRITE-PLAN §7.3 W2). Middleware already checks every gated
 * POST; each handler checks again with the identity it has verified, so a matcher change cannot
 * open trading. Fails CLOSED: if the database cannot answer, nothing is quoted or sent.
 */

export type BetaAccess = "gate-off" | "allowlist" | "invite" | "none";

export async function betaAccessOf(
  deps: BetaDeps,
  wallet: string,
): Promise<BetaAccess> {
  const config = deps.config();
  if (!config.gate) return "gate-off";
  if (config.wallets.has(wallet)) return "allowlist";
  let granted: boolean;
  try {
    granted = await hasBetaAccess(deps.db(), wallet);
  } catch (error) {
    logger.warn(
      { err: error },
      "beta access check failed; refusing (fail closed)",
    );
    throw new AppError("BETA_ACCESS_UNAVAILABLE", {
      detail: "beta access lookup failed",
      cause: error,
    });
  }
  return granted ? "invite" : "none";
}

export async function assertBetaAccess(
  deps: BetaDeps,
  wallet: string,
  publicMessage?: string,
): Promise<void> {
  if ((await betaAccessOf(deps, wallet)) === "none")
    throw new AppError("BETA_ACCESS_REQUIRED", {
      publicMessage,
      detail: "no beta access",
    });
}

/**
 * Every mainnet quote (ticket, basket, creator basket and Action), in this order:
 * 1. location (legal: a restricted visitor is never invited to do anything else);
 * 2. beta access (who may use the product at all during Phase A);
 * 3. terms accepted (signed only by wallets that can actually trade, so an uninvited wallet is
 *    never asked to accept legal terms for a product it cannot use).
 */
export async function assertTradeAccess(
  request: Request,
  wallet: string,
  deps: { compliance: TermsDeps; beta: BetaDeps },
  messages: { beta?: string; terms?: string } = {},
): Promise<void> {
  assertJurisdiction(request, "trade", deps.compliance.policy());
  await assertBetaAccess(deps.beta, wallet, messages.beta);
  await assertTermsAccepted(deps.compliance, wallet, messages.terms);
}
