import { createHash, timingSafeEqual } from "node:crypto";
import { ORIGIN_HEADER, ORIGIN_SECRET_PATTERN, proxyMode } from "./proxy";

/**
 * Phase H Step 2: the origin lock. In `cloudflare` proxy mode every request must carry
 * `x-aroma-origin: <AROMA_ORIGIN_SECRET>`, which a Cloudflare Transform Rule sets at the edge
 * (overwriting anything the client sent). A request that reaches the app any other way, for
 * example straight to the VPS or from another container, is refused with 403 ORIGIN_REFUSED.
 * It is defence in depth on top of the outbound-only tunnel.
 *
 * - Constant time: both sides are hashed to 32 bytes, then compared with timingSafeEqual, so
 *   neither the length nor a prefix of the secret leaks through timing.
 * - Fail closed: a missing or malformed secret refuses everything (boot refuses it too).
 * - The header is stripped before the request reaches a route (middleware.ts) and is never
 *   logged or echoed (the logger redacts it, server/logger.ts).
 */

type EnvLike = Readonly<Record<string, unknown>>;

export { ORIGIN_HEADER };

export function originLockApplies(env: EnvLike): boolean {
  return proxyMode(env) === "cloudflare";
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export type OriginCheck = "ok" | "missing" | "mismatch" | "unconfigured";

export function checkOrigin(headers: Headers, env: EnvLike): OriginCheck {
  const raw = env.AROMA_ORIGIN_SECRET;
  const secret = typeof raw === "string" ? raw.trim() : "";
  if (!ORIGIN_SECRET_PATTERN.test(secret)) return "unconfigured";
  const sent = headers.get(ORIGIN_HEADER);
  if (!sent) return "missing";
  return timingSafeEqual(digest(sent.trim()), digest(secret))
    ? "ok"
    : "mismatch";
}

/** True when the request may pass: the lock does not apply, or it carries the right secret. */
export function originAccepted(headers: Headers, env: EnvLike): boolean {
  return !originLockApplies(env) || checkOrigin(headers, env) === "ok";
}
