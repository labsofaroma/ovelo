export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Phase H: GET /api/v1/health/live, the liveness probe (Docker HEALTHCHECK,
 * deploy/healthcheck.mjs). It checks only that this process serves requests: no external call,
 * no secret, no version or host. Middleware lets it skip the rate limiter (so a Redis outage
 * cannot mark the process unhealthy and restart it in a loop), but in cloudflare mode it still
 * needs the origin secret like every route. Readiness is /api/v1/health.
 */
export function GET(): Response {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
