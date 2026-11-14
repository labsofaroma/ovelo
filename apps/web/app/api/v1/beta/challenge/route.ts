import { betaChallengeBodySchema } from "@/features/beta/schema";
import { betaDeps } from "@/features/beta/server/deps";
import { betaOrigin, betaRoute, noStore } from "@/features/beta/server/http";
import { issueBetaChallenge } from "@/features/beta/server/redeem";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/beta/challenge { wallet, code } → `{ nonce, message, expiresAt }`. The wallet
 * signs `message`, which is bound to this site, the wallet and the SHA-256 of the code. Issuing
 * changes no application state (a 5-minute single-use nonce), like the M5 creator challenge.
 */
export const POST = betaRoute("v1/beta/challenge", async (request) => {
  const body = await parse(betaChallengeBodySchema, { maxBytes: 1_024 })(
    request,
  );
  const challenge = await issueBetaChallenge(betaDeps(), {
    origin: betaOrigin(request),
    wallet: body.wallet,
    code: body.code,
  });
  return Response.json(challenge, { headers: noStore });
});
