import { complianceDeps } from "@/features/compliance/server/deps";
import { assertJurisdiction } from "@/features/compliance/server/gate";
import { betaRedeemBodySchema } from "@/features/beta/schema";
import { betaDeps } from "@/features/beta/server/deps";
import { betaOrigin, betaRoute, noStore } from "@/features/beta/server/http";
import { redeemBeta } from "@/features/beta/server/redeem";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/beta/redeem { wallet, code, nonce, signature }. State-changing, so it requires the
 * wallet's Ed25519 signature over the challenge (AGENTS.md rule 2). The location is checked first
 * (a restricted visitor cannot burn an invite), then the nonce is consumed (a replay fails), then
 * the code is claimed atomically.
 */
export const POST = betaRoute("v1/beta/redeem", async (request) => {
  assertJurisdiction(request, "trade", complianceDeps().policy());
  const body = await parse(betaRedeemBodySchema, { maxBytes: 2_048 })(request);
  const result = await redeemBeta(betaDeps(), {
    origin: betaOrigin(request),
    ...body,
  });
  return Response.json(result, { headers: noStore });
});
