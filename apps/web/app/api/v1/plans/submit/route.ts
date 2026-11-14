import { productionServices } from "@/features/invest/server/deps";
import { investHandlers } from "@/features/invest/server/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/plans/submit: `{ authorization, transaction }`. State-changing: needs the HMAC
 * authorization from prepare AND the owner's valid signature on the authorized bytes (AGENTS.md
 * rule 2). Idempotent per request id. Writes receipts and plans_index after confirmation.
 */
export async function POST(request: Request): Promise<Response> {
  return investHandlers(productionServices).submit(request);
}
