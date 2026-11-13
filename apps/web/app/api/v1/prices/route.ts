import { freshPrices, pricesQuerySchema } from "@/features/trade/server/prices";
import { isV1Enabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { errorResponse, parseValue } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/prices?mints=a,b: fresh observed token prices for paper practice (read-only). */
export async function GET(request: Request): Promise<Response> {
  try {
    if (!isV1Enabled()) throw new AppError("NOT_FOUND");
    const mints = parseValue(
      pricesQuerySchema,
      new URL(request.url).searchParams.get("mints") ?? "",
    );
    return Response.json(await freshPrices(mints), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, { route: "v1/prices" });
  }
}
