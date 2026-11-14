import "server-only";
import { keyringFromEnv, openAuthorization } from "@/server/auth/trade";
import { ERROR_CODES, mapError, type ErrorCode } from "@/server/errors";
import { readLimitedJson } from "@/server/http";
import { betaEntry, type BetaEntry } from "../paths";
import type { BetaDeps } from "./deps";
import { betaAccessOf } from "./gate";

/**
 * The middleware side of the private-beta gate (REWRITE-PLAN §7.3 W2). For every gated POST
 * while the gate is on, it finds the wallet the request acts for and checks its access (the
 * allowlist, then Postgres). The handler checks again with the identity it verifies itself.
 *
 * - quote: the body's `taker`; Action POST: the body's `account` (read from a CLONE, so the
 *   handler still receives the untouched body, and capped like every body);
 * - submit: the `taker` inside the HMAC-verified trade authorization (expiry is the handler's
 *   job; a forged token never names a wallet here);
 * - prototype trading routes: always refused while the gate is on (they know nothing of beta
 *   access).
 * Anything it cannot read, and any database failure, is a refusal (fail closed).
 */
export type BetaRefusal = {
  status: number;
  body: { code: ErrorCode; message: string };
};

const refuse = (code: ErrorCode, message?: string): BetaRefusal => ({
  status: ERROR_CODES[code].status,
  body: { code, message: message ?? ERROR_CODES[code].message },
});

const PROTOTYPE_CLOSED =
  "Trading on this preview is open only to private-beta wallets through the new app. Nothing was quoted or sent.";

async function walletOf(
  entry: Exclude<BetaEntry, "prototype">,
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const body = (await readLimitedJson(request.clone(), maxBytes)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object") return null;
  const field =
    entry === "quote" ? body.taker : entry === "action" ? body.account : null;
  if (entry !== "submit") return typeof field === "string" ? field : null;
  return openAuthorization(body.authorization, keyringFromEnv(), {
    allowExpired: true,
  }).taker;
}

export async function betaEdgeRefusal(
  request: Request,
  pathname: string,
  deps: BetaDeps,
  maxBytes: number,
): Promise<BetaRefusal | null> {
  const entry = betaEntry(pathname, request.method);
  if (!entry) return null;
  let gate: boolean;
  try {
    gate = deps.config().gate;
  } catch {
    gate = true;
  }
  if (!gate) return null;
  if (entry === "prototype")
    return refuse("BETA_ACCESS_REQUIRED", PROTOTYPE_CLOSED);
  let wallet: string | null;
  try {
    wallet = await walletOf(entry, request, maxBytes);
  } catch (error) {
    const code = mapError(error).body.code;
    // A body too large keeps its own answer; anything else unreadable is a beta refusal.
    return code === "PAYLOAD_TOO_LARGE"
      ? refuse(code)
      : refuse("BETA_ACCESS_REQUIRED");
  }
  if (!wallet) return refuse("BETA_ACCESS_REQUIRED");
  try {
    const access = await betaAccessOf(deps, wallet);
    return access === "none" ? refuse("BETA_ACCESS_REQUIRED") : null;
  } catch {
    // betaAccessOf maps a database failure to BETA_ACCESS_UNAVAILABLE; anything else too.
    return refuse("BETA_ACCESS_UNAVAILABLE");
  }
}
