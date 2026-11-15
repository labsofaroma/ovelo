import { randomBytes } from "node:crypto";

/**
 * Phase H: a local `next start` (NODE_ENV=production) must say what it is, or the boot refuses it
 * (server/platform.ts). Every E2E and smoke server runs as a self-host development deployment:
 * the production rules are off, so the opt-in test switches can apply.
 */
export const LOCAL_START = {
  OVELO_PLATFORM: "selfhost",
  OVELO_DEPLOY_ENV: "development",
} as const;

/**
 * Phase H Step 2: the fork and invest E2E apps run exactly as production does behind Cloudflare
 * (OVELO_PROXY_MODE=cloudflare with the origin lock), and Playwright plays the edge: it sends
 * CF-IPCountry, CF-Connecting-IP and x-ovelo-origin. The secret is random per run; the runner
 * sets it in its own environment, so Playwright (a child process) reads the same value.
 */
process.env.OVELO_E2E_ORIGIN_SECRET ||= randomBytes(32).toString("base64url");
export const ORIGIN_SECRET = process.env.OVELO_E2E_ORIGIN_SECRET;

export const EDGE_START = {
  ...LOCAL_START,
  OVELO_PROXY_MODE: "cloudflare",
  OVELO_ORIGIN_SECRET: ORIGIN_SECRET,
} as const;

/**
 * Step 8 (`E2E_TARGET=container`): a Cloudflare stand-in sits in front of the image. The browser
 * then sends only where it "is" (x-edge-client-*), and the stand-in sets the CF headers and the
 * origin secret, as the real edge does. Otherwise the browser plays the edge itself.
 */
const behindStandIn = () => process.env.OVELO_E2E_EDGE_PROXY === "1";

/** The headers Cloudflare's edge adds: the country, the client IP (optional) and the lock. */
export function edgeHeaders(
  country = "DE",
  ip?: string,
): Record<string, string> {
  if (behindStandIn())
    return {
      "x-edge-client-country": country,
      ...(ip ? { "x-edge-client-ip": ip } : {}),
    };
  return {
    "cf-ipcountry": country,
    "x-ovelo-origin": ORIGIN_SECRET,
    ...(ip ? { "cf-connecting-ip": ip } : {}),
  };
}

/** A client IP as Cloudflare reports it (merged with the context's edge headers). */
export const clientIp = (ip: string): Record<string, string> =>
  behindStandIn() ? { "x-edge-client-ip": ip } : { "cf-connecting-ip": ip };

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
