import type { CheckStatus, HealthReport } from "./health";

/**
 * Phase H Step 4: what GET /api/v1/health shows the internet. The uptime monitor and the
 * runbook alerts need, per dependency, only `ok` | `degraded` | `down` (and `skipped` for an
 * unconfigured optional provider), plus the RPC failover facts (`primary`, `fallback`,
 * `fallbackInUse`). Latencies, slots, lag, upstream HTTP statuses and whether an API key is set
 * are left out: they help map the deployment and are logged for operators instead. Versions,
 * hosts and keys were never in the report.
 */
export type PublicStatus = "ok" | "degraded" | "down" | "skipped";

export type PublicHealth = {
  status: HealthReport["status"];
  timestamp: string;
  checks: Record<string, Record<string, PublicStatus | boolean>>;
};

const STATUS: Record<CheckStatus, PublicStatus> = {
  ok: "ok",
  degraded: "degraded",
  fail: "down",
  skipped: "skipped",
};

/** Facts kept per check (all status-like). Anything not listed is dropped. */
const KEPT: Record<string, readonly string[]> = {
  rpc: ["primary", "fallback", "fallbackInUse"],
};

const asStatus = (value: unknown): PublicStatus | boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value in STATUS)
    return STATUS[value as CheckStatus];
  return undefined;
};

export function publicHealth(report: HealthReport): PublicHealth {
  const checks: PublicHealth["checks"] = {};
  for (const [name, check] of Object.entries(report.checks)) {
    const out: Record<string, PublicStatus | boolean> = {
      status: STATUS[check.status] ?? "down",
    };
    for (const fact of KEPT[name] ?? []) {
      const value = asStatus(check[fact]);
      if (value !== undefined) out[fact] = value;
    }
    checks[name] = out;
  }
  return { status: report.status, timestamp: report.timestamp, checks };
}
