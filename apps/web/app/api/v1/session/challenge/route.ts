import {
  issueSessionChallenge,
  sessionChallengeBodySchema,
  sessionDeps,
} from "@/features/account/server/session";
import { expectedOrigin } from "@/features/creators/http";
import { errorResponse, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/session/challenge { scope, wallet } → `{ nonce, message, expiresAt }` for a
 * read-only wallet session (creator dashboard, portfolio CSV). Issuing changes no state.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parse(sessionChallengeBodySchema, { maxBytes: 1_024 })(
      request,
    );
    return Response.json(
      await issueSessionChallenge(sessionDeps(), expectedOrigin(request), body),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, { route: "v1/session/challenge" });
  }
}
