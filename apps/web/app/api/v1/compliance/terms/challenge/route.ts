import { complianceDeps } from "@/features/compliance/server/deps";
import {
  complianceRoute,
  noStore,
  termsOrigin,
} from "@/features/compliance/server/http";
import { issueTermsChallenge } from "@/features/compliance/server/terms";
import { termsChallengeBodySchema } from "@/features/compliance/schema";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/compliance/terms/challenge { wallet } → `{ nonce, message, version, hash,
 * expiresAt }`. The wallet signs `message` (current terms version and SHA-256). Issuing changes
 * no application state (a 5-minute single-use nonce), like the M5 creator challenge.
 */
export const POST = complianceRoute(
  "v1/compliance/terms/challenge",
  async (request) => {
    const body = await parse(termsChallengeBodySchema, { maxBytes: 1_024 })(
      request,
    );
    const challenge = await issueTermsChallenge(complianceDeps(), {
      origin: termsOrigin(request),
      wallet: body.wallet,
    });
    return Response.json(challenge, { headers: noStore });
  },
);
