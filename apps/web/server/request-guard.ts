/**
 * Pure request-policy decisions for middleware (ported from the prototype's request-policy.ts and the
 * prototype middleware). No I/O and no `server-only`, so they are unit-tested directly.
 */

type Env = Record<string, string | undefined>;

export function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

/**
 * Browser origins allowed to call the API. A request without `Origin` (native apps, servers) is
 * allowed here; every state-changing route still requires a signature, HMAC token or bearer
 * secret (AGENTS.md rule 2, AUDIT M-6).
 */
export function allowedOrigin(
  origin: string | null,
  requestOrigin: string,
  configured: string,
  development: boolean,
): boolean {
  if (!origin || origin === requestOrigin) return true;
  const allowed = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (development)
    allowed.push(
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      "http://localhost:19006",
    );
  return allowed.includes(origin);
}

// Phase H: client IP, scheme, host and proxy trust come from the one header parser.
export { clientIp, requestHost, requestProtocol, trustsProxy } from "./proxy";
import { requestHost } from "./proxy";

export type Bucket = "read" | "write" | "trade" | "creator" | "faucet";

const TRADE_PATHS = [
  /^\/api\/v1\/trade(\/|$)/,
  // v1 Actions quote, build and simulate a basket order (M5b B4); the confirm callback reads
  // a transaction back from mainnet.
  /^\/api\/v1\/actions\//,
  // M7: plan prepare (chain reads + simulation) and submit (send + confirm) on devnet.
  /^\/api\/v1\/plans\/(prepare-create|submit)$/,
  /^\/api\/v1\/plans\/[1-9A-HJ-NP-Za-km-z]{32,44}\/prepare-close$/,
];

/** M7: the devnet faucet sends tokens; its own per-wallet, per-IP and daily limits apply too. */
const FAUCET_PATHS = [/^\/api\/v1\/faucet$/];

/**
 * Creator calls that are cheap to spam and costly to serve or guess at: issuing a challenge (a
 * Redis write per call) and redeeming an invite (a code guess). Saving, publishing and archiving
 * a basket stay in the write bucket; each also consumes a challenge (M5b A3).
 */
const CREATOR_PATHS = [
  /^\/api\/v1\/creators\/challenge$/,
  /^\/api\/v1\/creators\/invites\/redeem$/,
  // M11: wallet challenges for notification settings and read-only wallet sessions.
  /^\/api\/v1\/notifications\/challenge$/,
  /^\/api\/v1\/session\/challenge$/,
];

/** Reads, writes, trades and creator auth are limited separately (AUDIT H-4, M4 B8, M5b A3). */
export function bucketFor(pathname: string, method: string): Bucket {
  if (method === "GET" || method === "HEAD") return "read";
  if (TRADE_PATHS.some((pattern) => pattern.test(pathname))) return "trade";
  if (FAUCET_PATHS.some((pattern) => pattern.test(pathname))) return "faucet";
  return CREATOR_PATHS.some((pattern) => pattern.test(pathname))
    ? "creator"
    : "write";
}

export const LIMITS: Record<Bucket, { limit: number; windowSeconds: number }> =
  {
    read: { limit: 120, windowSeconds: 60 },
    write: { limit: 20, windowSeconds: 60 },
    trade: { limit: 10, windowSeconds: 60 },
    creator: { limit: 10, windowSeconds: 60 },
    faucet: { limit: 5, windowSeconds: 60 },
  };

/** Request body cap, enforced on Content-Length before the route reads the stream. */
export function maxBodyBytes(pathname: string): number {
  // Five 4,096-byte transactions are 27,320 base64 bytes before authorization and JSON.
  return /^\/api\/v1\/trade\/submit$/.test(pathname) ? 32_768 : 16_384;
}

/** Hostname (no port) the client used. */
export function requestHostname(
  headers: Headers,
  fallback: string,
  env: Env,
): string {
  const raw = requestHost(headers, fallback, env);
  // Strip a port; keep IPv6 brackets ("[::1]:3000" -> "[::1]").
  return raw.startsWith("[")
    ? raw.slice(0, raw.indexOf("]") + 1)
    : (raw.split(":")[0] ?? raw);
}
