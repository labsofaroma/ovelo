import { betaDeps } from "@/features/beta/server/deps";
import { assertBetaAccess } from "@/features/beta/server/gate";
import {
  reserveForSubmit,
  settleAfterThrow,
  settleReservation,
} from "@/features/caps/server/caps";
import { capsDeps } from "@/features/caps/server/deps";
import { complianceDeps } from "@/features/compliance/server/deps";
import { assertJurisdiction } from "@/features/compliance/server/gate";
import { submitRequestSchema } from "@/features/trade/schema";
import {
  publicRecord,
  submitSignedTrade,
} from "@/features/trade/server/service";
import { keyringFromEnv, openAuthorization } from "@/server/auth/trade";
import { isV1Enabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { assertSameOrigin, errorResponse, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/trade/submit: `{ authorization, signedTransactions[] }`. State-changing, so it
 * requires the HMAC authorization from /quote AND a valid wallet signature on every authorized
 * message (AGENTS.md rule 2). Idempotent per request id: a replay returns the same trade and is
 * never broadcast twice. 202 while the outcome is pending or unknown.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isV1Enabled()) throw new AppError("NOT_FOUND");
    assertSameOrigin(request);
    // M9 compliance gate: the location is checked again at submit (the terms were checked at quote).
    assertJurisdiction(request, "trade", complianceDeps().policy());
    // Five 4,096-byte V1 transactions are 27,320 base64 characters.
    const body = await parse(submitRequestSchema, { maxBytes: 32_768 })(
      request,
    );
    // Phase A beta gate (again, after middleware): the wallet named by the VERIFIED
    // authorization. Expiry and the signed bytes are checked by submitSignedTrade.
    const payload = openAuthorization(body.authorization, keyringFromEnv(), {
      allowExpired: true,
    });
    await assertBetaAccess(betaDeps(), payload.taker);
    // Phase A caps (W3): re-check, then reserve atomically for this authorization (a replay
    // counts once). Released if the trade fails or never lands; kept once it confirms.
    const caps = capsDeps();
    await reserveForSubmit(caps, {
      requestId: payload.requestId,
      wallet: payload.taker,
      inputMint: payload.receipt.inputMint,
      amountRaw: BigInt(payload.receipt.inAmount),
      expiresAt: payload.expiresAt,
    });
    let record: Awaited<ReturnType<typeof submitSignedTrade>>;
    try {
      record = await submitSignedTrade(body);
    } catch (error) {
      await settleAfterThrow(caps, payload.requestId);
      throw error;
    }
    await settleReservation(caps, payload.requestId, record.status);
    return Response.json(publicRecord(record), {
      status:
        record.status === "confirmed" || record.status === "failed" ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, { route: "v1/trade/submit" });
  }
}
