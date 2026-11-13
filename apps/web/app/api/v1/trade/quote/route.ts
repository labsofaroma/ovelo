import { quoteRequestSchema } from "@/features/trade/schema";
import { quoteTrade } from "@/features/trade/server/service";
import { isV1Enabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { assertSameOrigin, errorResponse, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/trade/quote: one stock or one basket. Returns `{ transactions[], authorization,
 * quote }`: unsigned, simulated transactions, an HMAC authorization bound to their exact bytes
 * and the wallet, and the reviewed figures (source, route, price impact, fees, as-of, expiry).
 * Nothing is signed or stored by the server.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isV1Enabled()) throw new AppError("NOT_FOUND");
    assertSameOrigin(request);
    const body = await parse(quoteRequestSchema, { maxBytes: 4_096 })(request);
    const prepared = await quoteTrade(body);
    return Response.json(prepared, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, { route: "v1/trade/quote" });
  }
}
