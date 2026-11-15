import { resolvePlatform, type PlatformProblem } from "./platform";

/**
 * Phase H Step 2: the ONE header parser for what a proxy tells us about the client: its IP, the
 * scheme and host it used, and its country. Nothing else in the app reads a forwarding or geo
 * header (a repo test greps for the names).
 *
 * `AROMA_PROXY_MODE` (replaces the boolean AROMA_TRUST_PROXY, which now refuses to boot):
 * - `vercel` (default on Vercel, allowed only there): Vercel overwrites X-Real-IP,
 *   X-Forwarded-For, X-Forwarded-Proto/Host and x-vercel-ip-country. Pre-Phase-H behaviour.
 * - `cloudflare` (self-host behind Cloudflare and its tunnel): the IP comes ONLY from
 *   CF-Connecting-IP and the country ONLY from CF-IPCountry; X-Forwarded-For, X-Real-IP,
 *   True-Client-IP and x-vercel-ip-country are ignored (a client can send any of them, and
 *   Cloudflare passes them through). The scheme is Cloudflare's X-Forwarded-Proto. The origin
 *   lock (server/origin-lock.ts) makes sure only Cloudflare reaches the app in this mode.
 * - `none` (default off Vercel): no header is trusted. The IP is the shared key `local` (the
 *   socket peer cannot be read in middleware), and the country is unknown, so trading fails
 *   closed in production (compliance policy `missingCountry: block`).
 *
 * Self-host production and beta must run in `cloudflare` mode; anything else refuses to boot.
 * Pure and dependency-free (no node:crypto here), so it is unit-tested directly.
 */

export type ProxyMode = "vercel" | "cloudflare" | "none";

type EnvLike = Readonly<Record<string, unknown>>;

const MODES: readonly ProxyMode[] = ["vercel", "cloudflare", "none"];

/** The shared rate-limit key when the client IP cannot be known (pre-Phase-H value). */
export const UNKNOWN_IP = "local";

/** The header Cloudflare's Transform Rule sets to AROMA_ORIGIN_SECRET (server/origin-lock.ts). */
export const ORIGIN_HEADER = "x-aroma-origin";

/** Header names, each read in exactly one place below. */
const H = {
  vercelCountry: "x-vercel-ip-country",
  realIp: "x-real-ip",
  forwardedFor: "x-forwarded-for",
  forwardedProto: "x-forwarded-proto",
  forwardedHost: "x-forwarded-host",
  cfIp: "cf-connecting-ip",
  cfCountry: "cf-ipcountry",
} as const;

/** Vercel's country header name, for Vercel-mode tests and fixtures. */
export const VERCEL_COUNTRY_HEADER = H.vercelCountry;

/** Cloudflare's special CF-IPCountry values: XX (no country data) and T1 (Tor exit). */
const CF_UNKNOWN = new Set(["XX"]);
const CF_ANONYMOUS = new Set(["T1"]);

/** AROMA_ORIGIN_SECRET: 32 or more characters of base64, base64url or hex (openssl rand -base64 48). */
export const ORIGIN_SECRET_PATTERN = /^[A-Za-z0-9+/=_-]{32,}$/;

function text(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export type ProxyAnswer = {
  mode: ProxyMode;
  problems: readonly PlatformProblem[];
};

export function resolveProxy(env: EnvLike): ProxyAnswer {
  const problems: PlatformProblem[] = [];
  const problem = (variable: string, message: string) =>
    problems.push({ variable, problem: message });
  const platform = resolvePlatform(env);
  const onVercel = platform.platform === "vercel";

  if (text(env, "AROMA_TRUST_PROXY") !== undefined)
    problem(
      "AROMA_TRUST_PROXY",
      "was replaced by AROMA_PROXY_MODE (vercel | cloudflare | none); remove it",
    );

  const raw = text(env, "AROMA_PROXY_MODE");
  let mode: ProxyMode = onVercel ? "vercel" : "none";
  if (raw !== undefined) {
    if (!MODES.includes(raw as ProxyMode)) {
      problem("AROMA_PROXY_MODE", "must be vercel, cloudflare or none");
      mode = "none";
    } else mode = raw as ProxyMode;
  }
  if (mode === "vercel" && !onVercel) {
    problem(
      "AROMA_PROXY_MODE",
      "vercel is allowed only on the Vercel platform",
    );
    mode = "none"; // fail closed: trust nothing
  }
  if (mode === "cloudflare" && onVercel) {
    problem(
      "AROMA_PROXY_MODE",
      "cloudflare is for self-host; Vercel uses vercel",
    );
    mode = "none";
  }
  if (mode === "cloudflare") {
    const secret = text(env, "AROMA_ORIGIN_SECRET");
    if (!secret)
      problem(
        "AROMA_ORIGIN_SECRET",
        "is required when AROMA_PROXY_MODE=cloudflare",
      );
    else if (!ORIGIN_SECRET_PATTERN.test(secret))
      problem(
        "AROMA_ORIGIN_SECRET",
        "must be 32 or more base64/hex characters (openssl rand -base64 48)",
      );
  }
  const origin = text(env, "AROMA_ORIGIN_SECRET");
  // The origin secret lives in the Cloudflare dashboard (Transform Rule), so it must never be
  // the value of a secret that protects anything else.
  if (origin)
    for (const other of OTHER_SECRETS)
      if (text(env, other) === origin)
        problem("AROMA_ORIGIN_SECRET", `must differ from ${other}`);
  if (
    platform.platform === "selfhost" &&
    platform.productionRules &&
    mode !== "cloudflare"
  )
    problem(
      "AROMA_PROXY_MODE",
      "must be cloudflare on a self-host production or beta deployment",
    );
  return { mode, problems };
}

export function proxyMode(env: EnvLike): ProxyMode {
  return resolveProxy(env).mode;
}

export function proxyProblems(env: EnvLike): readonly PlatformProblem[] {
  return resolveProxy(env).problems;
}

/** True when a proxy that overwrites the client headers is trusted (vercel or cloudflare). */
export function trustsProxy(env: EnvLike): boolean {
  return proxyMode(env) !== "none";
}

/** Secrets the origin secret must never equal (it is visible to Cloudflare account admins). */
const OTHER_SECRETS = [
  "AROMA_TRADE_SECRET",
  "AROMA_TRADE_SECRET_PREVIOUS",
  "AROMA_REVALIDATE_SECRET",
  "AROMA_NOTIFY_WORKER_SECRET",
  "CREATOR_AUTH_SECRET",
  "AROMA_RECURRING_AUTH_SECRET",
  "AROMA_RECURRING_EXECUTOR_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const IP = /^[0-9A-Fa-f:.]{2,45}$/;

/** The client IP for rate limits and per-IP caps. Never a value the client chose. */
export function clientIp(headers: Headers, env: EnvLike): string {
  const mode = proxyMode(env);
  if (mode === "cloudflare") {
    const value = headers.get(H.cfIp)?.trim();
    return value && IP.test(value) ? value : "unknown";
  }
  if (mode === "vercel")
    return (
      headers.get(H.realIp)?.trim() ||
      headers.get(H.forwardedFor)?.split(",")[0]?.trim() ||
      "unknown"
    );
  return UNKNOWN_IP;
}

/** The scheme the client used (http or https). */
export function requestProtocol(
  headers: Headers,
  urlProtocol: string,
  env: EnvLike,
): string {
  const forwarded = trustsProxy(env)
    ? headers.get(H.forwardedProto)?.split(",")[0]?.trim()
    : undefined;
  return (forwarded || urlProtocol.replace(":", "") || "http").toLowerCase();
}

/**
 * The host (with port) the client used. Vercel: X-Forwarded-Host, else Host. Cloudflare: Host
 * (the tunnel keeps the public hostname; Cloudflare never sets X-Forwarded-Host, so a client
 * could). None: Host.
 */
export function requestHost(
  headers: Headers,
  fallback: string,
  env: EnvLike,
): string {
  const forwarded =
    proxyMode(env) === "vercel"
      ? headers.get(H.forwardedHost)?.split(",")[0]?.trim()
      : undefined;
  return forwarded || headers.get("host") || fallback;
}

export type CountryAnswer =
  | { ok: true; raw: string }
  | { ok: false; reason: "untrusted-proxy" | "missing" | "anonymous" };

/**
 * The raw country header of the trusted proxy, upper case. Cloudflare's `XX` is missing and
 * `T1` (Tor) is anonymous: both are unknown to the policy, so trading fails closed.
 */
export function clientCountry(headers: Headers, env: EnvLike): CountryAnswer {
  const mode = proxyMode(env);
  if (mode === "none") return { ok: false, reason: "untrusted-proxy" };
  const raw =
    headers
      .get(mode === "cloudflare" ? H.cfCountry : H.vercelCountry)
      ?.trim()
      .toUpperCase() ?? "";
  if (!raw) return { ok: false, reason: "missing" };
  if (mode === "cloudflare") {
    if (CF_UNKNOWN.has(raw)) return { ok: false, reason: "missing" };
    if (CF_ANONYMOUS.has(raw)) return { ok: false, reason: "anonymous" };
  }
  return { ok: true, raw };
}
