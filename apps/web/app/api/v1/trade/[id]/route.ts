import { settleReservation } from "@/features/caps/server/caps";
import { capsDeps } from "@/features/caps/server/deps";
import { tradeIdSchema } from "@/features/trade/schema";
import { publicRecord, tradeStatus } from "@/features/trade/server/service";
import { errorResponse, parseValue } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/trade/:id: the trade's status, refreshed from chain signatures while it is not final
 * (confirmation tracking). The id is the unguessable request id the quote issued.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = parseValue(tradeIdSchema, (await params).id);
    const record = await tradeStatus(id);
    // Phase A caps (W3): a final status settles the trade's cap reservation (idempotent).
    await settleReservation(capsDeps(), id, record.status);
    return Response.json(publicRecord(record), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, { route: "v1/trade/[id]" });
  }
}
