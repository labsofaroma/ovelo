/**
 * Content Security Policy for every route (AUDIT H-6; M9: the prototype's policy is gone). Pure (no `server-only`, no I/O): the middleware
 * calls it per request with a fresh nonce, and tests call it directly.
 *
 * - script-src: 'self' + the per-request nonce + 'strict-dynamic'. No 'unsafe-inline'. Scripts
 *   loaded by a nonced script (Next chunks, the lazily loaded wallet stack) are allowed by
 *   'strict-dynamic'; nothing injected by markup is.
 * - connect-src: an explicit list DERIVED FROM CONFIGURATION (the browser RPC and its websocket,
 *   Sentry's ingest host, Plausible when configured), plus the fixed endpoints the client stack
 *   talks to: Jupiter, Pyth Hermes, Jito, WalletConnect (wallet-adapter mobile/QR) and
 *   Cloudflare Turnstile. Never `https:` or `wss:` wildcards. Wallet-only login (REWRITE-PLAN
 *   §7.3 W1): no embedded-wallet provider hosts in connect-src or frame-src.
 * - style-src keeps 'unsafe-inline': React style attributes and Base UI positioning need it,
 *   and styles cannot execute code. Scripts are the XSS vector this closes.
 */

type Env = Record<string, string | undefined>;

export const FIXED_CONNECT_SOURCES = [
  // Jupiter (prices for paper practice go through our API; listed for the wallet stack's use).
  "https://api.jup.ag",
  "https://lite-api.jup.ag",
  // Pyth Hermes reference prices.
  "https://hermes.pyth.network",
  // Jito Block Engine (bundles are sent by the server; listed for status links only).
  "https://mainnet.block-engine.jito.wtf",
  // WalletConnect relay and verify (wallet-adapter mobile / QR wallets).
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "https://verify.walletconnect.org",
  "https://explorer-api.walletconnect.com",
  // Cloudflare Turnstile.
  "https://challenges.cloudflare.com",
] as const;

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

function origin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^(https|wss|http|ws):$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Every connect-src origin, deduplicated, from configuration plus the fixed list. */
export function connectSources(env: Env): string[] {
  const rpc = origin(env.NEXT_PUBLIC_SOLANA_RPC_URL) ?? DEFAULT_RPC;
  // M7: `/invest` talks to devnet from the browser (wallet genesis check, confirmations).
  const devnet =
    origin(env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL) ?? DEFAULT_DEVNET_RPC;
  // M7 test builds only: the local validator (loopback), when the localnet cluster is on.
  const localnet =
    env.NEXT_PUBLIC_AROMA_LOCALNET === "true" &&
    env.AROMA_V1_INVEST_CLUSTER === "localnet"
      ? origin(env.AROMA_V1_LOCALNET_RPC_URL)
      : null;
  const ws =
    origin(env.NEXT_PUBLIC_SOLANA_WS_URL) ??
    rpc.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const sentry = origin(env.NEXT_PUBLIC_SENTRY_DSN);
  const plausible = env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN
    ? "https://plausible.io"
    : null;
  return [
    ...new Set(
      [
        "'self'",
        rpc,
        ws,
        devnet,
        localnet,
        sentry,
        plausible,
        ...FIXED_CONNECT_SOURCES,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function buildCsp(input: {
  nonce: string;
  env: Env;
  development: boolean;
}): string {
  const { nonce, env, development } = input;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://xstocks-metadata.backed.fi https://prestocks.com https://backpack.exchange",
    "font-src 'self' data:",
    `connect-src ${connectSources(env).join(" ")}`,
    "frame-src https://verify.walletconnect.org https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** One HSTS header, two years, subdomains, preload (AUDIT L-2). Only ever sent over HTTPS. */
export const HSTS = "max-age=63072000; includeSubDomains; preload";

/**
 * HSTS with preload is a domain-wide, long-lived commitment: only a production deployment sends
 * it (VERCEL_ENV=production, or a production build off Vercel), only over HTTPS, never on
 * loopback. Vercel previews and local runs never do (M9).
 */
export function hstsApplies(
  env: Env,
  loopback: boolean,
  protocol: string,
): boolean {
  if (loopback || protocol !== "https") return false;
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}
