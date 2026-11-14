import { productionServices } from "@/features/invest/server/deps";
import { investHandlers } from "@/features/invest/server/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** POST /api/v1/plans/:pda/prepare-close: close + revoke in ONE unsigned, simulated transaction. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ pda: string }> },
): Promise<Response> {
  return investHandlers(productionServices).prepareClose(
    request,
    (await params).pda,
  );
}
