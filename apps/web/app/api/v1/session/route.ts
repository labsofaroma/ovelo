import {
  openScopedSession,
  sessionDeps,
  sessionOpenBodySchema,
} from "@/features/account/server/session";
import { expectedOrigin } from "@/features/creators/http";
import { errorResponse, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/session { scope, wallet, nonce, signature } → a 15-minute `ws1` token for that
 * scope. Wallet-signed, single use (AGENTS.md rule 2).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parse(sessionOpenBodySchema, { maxBytes: 2_048 })(
      request,
    );
    return Response.json(
      await openScopedSession(sessionDeps(), expectedOrigin(request), body),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, { route: "v1/session" });
  }
}
