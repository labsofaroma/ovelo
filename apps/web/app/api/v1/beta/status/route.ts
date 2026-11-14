import { betaDeps } from "@/features/beta/server/deps";
import { betaAccessOf } from "@/features/beta/server/gate";
import { betaRoute, noStore } from "@/features/beta/server/http";
import { base58Address } from "@/features/trade/schema";
import { parseValue } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/beta/status[?wallet=] → `{ gate, access }`. Read-only: whether the private-beta
 * gate is on and, for a wallet, whether it may trade. The trade ticket uses it to show the
 * redeem step before quoting. A database failure answers 503 BETA_ACCESS_UNAVAILABLE.
 */
export const GET = betaRoute("v1/beta/status", async (request) => {
  const deps = betaDeps();
  const walletParam = new URL(request.url).searchParams.get("wallet");
  const wallet = walletParam ? parseValue(base58Address, walletParam) : null;
  const gate = deps.config().gate;
  const access = wallet ? (await betaAccessOf(deps, wallet)) !== "none" : null;
  return Response.json({ gate, access }, { headers: noStore });
});
