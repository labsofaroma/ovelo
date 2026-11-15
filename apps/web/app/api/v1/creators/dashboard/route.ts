import { z } from "zod";
import { getDashboard } from "@/features/creators/dashboard";
import { creatorDeps } from "@/features/creators/http";
import { errorResponse, parseValue } from "@/server/http";
import { openSession } from "@/server/wallet-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/creators/dashboard[?basket=<id>] `Authorization: Bearer ws1.creator…`: the session
 * wallet's own baskets with usage, Blink share and versions. Another creator's basket → 403; a
 * wallet that is not a creator → 403. Read-only.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const wallet = openSession("creator", request.headers.get("authorization"));
    const basket = new URL(request.url).searchParams.get("basket");
    const basketId = basket === null ? undefined : parseValue(z.uuid(), basket);
    const deps = creatorDeps();
    const view = await getDashboard(deps.db(), wallet, {
      now: deps.now(),
      ...(basketId ? { basketId } : {}),
    });
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { route: "v1/creators/dashboard" });
  }
}
