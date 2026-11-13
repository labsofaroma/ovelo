import "server-only";
import { pingDb } from "./db/client";
import { isV1Enabled, tryGetEnv } from "./env";
import { logger } from "./logger";
import { getRedis } from "./redis";
import { getMainnetConnection } from "./rpc";

/**
 * Health report for GET /api/v1/health. Each check has a hard timeout. The report never contains
 * error text, hostnames or credentials: only a status, a latency and a few numeric facts.
 */
export type CheckStatus = "ok" | "degraded" | "fail" | "skipped";

export type CheckResult = {
  status: CheckStatus;
  latencyMs: number;
  /** Numeric facts only (e.g. slot, lagSeconds). */
  [fact: string]: number | string | boolean | undefined;
};

export type Probe = () => Promise<{
  status: CheckStatus;
  [fact: string]: number | string | boolean | undefined;
}>;

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  timestamp: string;
  checks: Record<string, CheckResult>;
};

export const CHECK_TIMEOUT_MS = 2500;
/** Block-time lag of a recently confirmed slot, in seconds. */
export const RPC_LAG_DEGRADED_SECONDS = 15;
export const RPC_LAG_FAIL_SECONDS = 60;

class ProbeTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout()), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function runHealthChecks(
  probes: Record<string, Probe>,
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const entries = await Promise.all(
    Object.entries(probes).map(
      async ([name, probe]): Promise<[string, CheckResult]> => {
        const started = now();
        try {
          const result = await withTimeout(probe(), timeoutMs);
          return [name, { ...result, latencyMs: now() - started }];
        } catch (error) {
          // The real cause goes to logs only. Logging must never turn a failed check into a 500.
          try {
            logger.warn(
              {
                check: name,
                timedOut: error instanceof ProbeTimeout,
                err: error,
              },
              "health check failed",
            );
          } catch {
            // ignore
          }
          return [name, { status: "fail", latencyMs: now() - started }];
        }
      },
    ),
  );
  const checks = Object.fromEntries(entries);
  const statuses = Object.values(checks).map((check) => check.status);
  const status = statuses.includes("fail")
    ? "down"
    : statuses.includes("degraded")
      ? "degraded"
      : "ok";
  return { status, timestamp: new Date(now()).toISOString(), checks };
}

/** 503 only when something is down; "degraded" still serves traffic. */
export function httpStatusFor(report: HealthReport): 200 | 503 {
  return report.status === "down" ? 503 : 200;
}

export function classifyRpcLag(lagSeconds: number): CheckStatus {
  if (lagSeconds > RPC_LAG_FAIL_SECONDS) return "fail";
  if (lagSeconds > RPC_LAG_DEGRADED_SECONDS) return "degraded";
  return "ok";
}

/** A probe whose dependency is not configured: skipped while v1 is off, failed once it is on. */
function unconfigured(): { status: CheckStatus } {
  return { status: isV1Enabled() ? "fail" : "skipped" };
}

/**
 * RPC: the mainnet genesis hash must match (the cluster guard), then "slot lag" is measured as
 * the age of a recently confirmed slot's block time. A node that has stopped following the
 * chain shows growing lag even though it still answers.
 */
export const rpcProbe: Probe = async () => {
  const connection = await getMainnetConnection(); // verifies the genesis hash
  const slot = await connection.getSlot("confirmed");
  // Use a slightly older slot: the tip's block time is often not yet available.
  const reference = slot - 4;
  const blockTime = await connection.getBlockTime(reference);
  if (blockTime === null) return { status: "degraded", slot };
  const lagSeconds = Math.max(0, Math.round(Date.now() / 1000 - blockTime));
  return { status: classifyRpcLag(lagSeconds), slot, lagSeconds };
};

export const redisProbe: Probe = async () => {
  const redis = getRedis();
  if (!redis) return unconfigured();
  const pong = await redis.ping();
  return { status: pong === "PONG" ? "ok" : "fail" };
};

export const dbProbe: Probe = async () => {
  const env = tryGetEnv();
  if (!env.ok || !env.env.server.DATABASE_URL) return unconfigured();
  await pingDb();
  return { status: "ok" };
};

export const defaultProbes: Record<string, Probe> = {
  rpc: rpcProbe,
  redis: redisProbe,
  db: dbProbe,
};
