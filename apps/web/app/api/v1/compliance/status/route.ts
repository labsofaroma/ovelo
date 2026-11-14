import { surfaceAllowed } from "@/features/compliance/jurisdiction";
import { complianceDeps } from "@/features/compliance/server/deps";
import { requestJurisdiction } from "@/features/compliance/server/gate";
import { complianceRoute, noStore } from "@/features/compliance/server/http";
import { currentTerms, termsStatus } from "@/features/compliance/server/terms";
import { base58Address } from "@/features/trade/schema";
import { parseValue } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/compliance/status[?wallet=] → whether this visitor may trade (trusted platform
 * country vs the policy), may browse, and, for a wallet, whether it accepted the current terms.
 * Read-only; the trade ticket uses it to show an honest blocked or terms state before quoting.
 */
export const GET = complianceRoute("v1/compliance/status", async (request) => {
  const deps = complianceDeps();
  const policy = deps.policy();
  const jurisdiction = requestJurisdiction(request, policy);
  const walletParam = new URL(request.url).searchParams.get("wallet");
  const wallet = walletParam ? parseValue(base58Address, walletParam) : null;
  const terms = wallet
    ? await termsStatus(deps, wallet)
    : { ...currentTerms(policy), accepted: null };
  return Response.json(
    {
      jurisdiction: jurisdiction.status,
      trade: surfaceAllowed(jurisdiction, "trade", policy),
      browse: surfaceAllowed(jurisdiction, "browse", policy),
      terms,
    },
    { headers: noStore },
  );
});
