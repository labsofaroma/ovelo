import { httpStatusFor, defaultProbes, runHealthChecks } from "@/server/health";
import { publicHealth } from "@/server/health-public";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/health (readiness, for the external uptime monitor): real checks for RPC (cluster
 * + slot lag), Redis and Postgres, each with a timeout. 200 when nothing is down, 503 otherwise.
 * Phase H: the body is the public projection (server/health-public.ts: ok, degraded or down per
 * dependency, plus the RPC failover facts); the full report goes to the logs when not ok.
 * Liveness, for Docker, is /api/v1/health/live.
 */
export async function GET(): Promise<Response> {
  const report = await runHealthChecks(defaultProbes);
  if (report.status !== "ok")
    logger.warn({ health: report }, "health check not ok");
  return Response.json(publicHealth(report), {
    status: httpStatusFor(report),
    headers: { "Cache-Control": "no-store" },
  });
}
