import { randomBytes } from "node:crypto";

/**
 * Phase H: a local `next start` (NODE_ENV=production) must say what it is, or the boot refuses it
 * (server/platform.ts). Every E2E and smoke server runs as a self-host development deployment:
 * the production rules are off, so the opt-in test switches can apply.
 */
export const LOCAL_START = {
  AROMA_PLATFORM: "selfhost",
  AROMA_DEPLOY_ENV: "development",
} as const;

/**
 * Phase H Step 2: the fork and invest E2E apps run exactly as production does behind Cloudflare
 * (AROMA_PROXY_MODE=cloudflare with the origin lock), and Playwright plays the edge: it sends
 * CF-IPCountry, CF-Connecting-IP and x-aroma-origin. The secret is random per run; the runner
 * sets it in its own environment, so Playwright (a child process) reads the same value.
 */
process.env.AROMA_E2E_ORIGIN_SECRET ||= randomBytes(32).toString("base64url");
export const ORIGIN_SECRET = process.env.AROMA_E2E_ORIGIN_SECRET;

export const EDGE_START = {
  ...LOCAL_START,
  AROMA_PROXY_MODE: "cloudflare",
  AROMA_ORIGIN_SECRET: ORIGIN_SECRET,
} as const;

/** The headers Cloudflare's edge adds: the country, the client IP (optional) and the lock. */
export function edgeHeaders(
  country = "DE",
  ip?: string,
): Record<string, string> {
  return {
    "cf-ipcountry": country,
    "x-aroma-origin": ORIGIN_SECRET,
    ...(ip ? { "cf-connecting-ip": ip } : {}),
  };
}

/** A client IP as Cloudflare reports it (merged with the context's edge headers). */
export const clientIp = (ip: string): Record<string, string> => ({
  "cf-connecting-ip": ip,
});

/** Wait (up to `seconds`) until the app answers `path` through the edge headers. */
export async function appReady(
  port: number,
  path: string,
  seconds = 60,
): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: edgeHeaders(),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
