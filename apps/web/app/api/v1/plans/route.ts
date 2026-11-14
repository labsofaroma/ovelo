import { productionServices } from "@/features/invest/server/deps";
import { investHandlers } from "@/features/invest/server/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/plans?owner=: the owner's v1 plans on devnet, read from chain, with timelines. */
export async function GET(request: Request): Promise<Response> {
  return investHandlers(productionServices).list(request);
}
