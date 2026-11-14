import { neonConfig } from "@neondatabase/serverless";

/**
 * LOCAL DEVELOPMENT AND E2E ONLY (M5b B6). The Neon serverless driver speaks Postgres over a
 * WebSocket to Neon's proxy. Locally, `scripts/local-db.sh` runs Docker Postgres plus Neon's
 * open-source wsproxy, and this points the driver at it (plain ws://, no TLS pipelining).
 *
 * It applies only when ALL hold, so it can never redirect a real database connection:
 * - AROMA_LOCAL_NEON_WS_PROXY is set (a host:port, outside the env schema like the other local
 *   test switches),
 * - the DATABASE_URL host is loopback (localhost, 127.0.0.1, ::1),
 * - this is not a Vercel production deployment.
 */
type Env = Record<string, string | undefined>;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PROXY = /^(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;

export function localNeonProxy(
  url: string,
  env: Env = process.env,
): string | null {
  const proxy = env.AROMA_LOCAL_NEON_WS_PROXY?.trim();
  if (!proxy || env.VERCEL_ENV === "production") return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return LOOPBACK.has(host) && PROXY.test(proxy) ? proxy : null;
}

/** Call before creating a Pool. Returns whether the local proxy is in use. */
export function configureLocalNeon(
  url: string,
  env: Env = process.env,
): boolean {
  const proxy = localNeonProxy(url, env);
  if (!proxy) return false;
  neonConfig.wsProxy = () => `${proxy}/v1`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  return true;
}
