import { productionServices } from "@/features/invest/server/deps";
import { investHandlers } from "@/features/invest/server/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/v1/plans/prepare-create: create plan + Subscriptions approval in ONE unsigned,
 * simulated transaction, an HMAC authorization and a plain-words summary. Changes no state;
 * the wallet signs and /submit sends.
 */
export async function POST(request: Request): Promise<Response> {
  return investHandlers(productionServices).prepareCreate(request);
}
