import { complianceDeps } from "@/features/compliance/server/deps";
import { requestJurisdiction } from "@/features/compliance/server/gate";
import {
  complianceRoute,
  noStore,
  termsOrigin,
} from "@/features/compliance/server/http";
import { acceptTerms } from "@/features/compliance/server/terms";
import { termsAcceptBodySchema } from "@/features/compliance/schema";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/compliance/terms/accept { wallet, nonce, signature, version }. State-changing,
 * so it requires the wallet's Ed25519 signature over the challenge (AGENTS.md rule 2). The nonce
 * is consumed first (a replay fails), the version must be the current one, and the stored row
 * keeps the exact signed message and the trusted platform country.
 */
export const POST = complianceRoute(
  "v1/compliance/terms/accept",
  async (request) => {
    const body = await parse(termsAcceptBodySchema, { maxBytes: 2_048 })(
      request,
    );
    const deps = complianceDeps();
    const accepted = await acceptTerms(deps, {
      origin: termsOrigin(request),
      ...body,
      country: requestJurisdiction(request, deps.policy()).country,
    });
    return Response.json({ accepted: true, ...accepted }, { headers: noStore });
  },
);
