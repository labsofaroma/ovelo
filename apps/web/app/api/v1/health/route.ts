import { httpStatusFor, defaultProbes, runHealthChecks } from "@/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/health: real checks for RPC (cluster + slot lag), Redis and Postgres, each with a
 * timeout. 200 when nothing is down, 503 otherwise. The body carries per-check status only, never
 * internal error text. (The prototype's /api/health is untouched.)
 */
export async function GET(): Promise<Response> {
  const report = await runHealthChecks(defaultProbes);
  return Response.json(report, {
    status: httpStatusFor(report),
    headers: { "Cache-Control": "no-store" },
  });
}
