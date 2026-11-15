/** A complete, real-looking `beta.<domain>` profile for the check:prod-env beta tests. */
const secret = (c: string) => c.repeat(40);
export const BETA_GOOD = {
  OVELO_SITE_URL: "https://beta.ovelo.trade",
  SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=k",
  NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.ovelo.trade",
  DATABASE_URL: "postgres://u:p@ep-cool-1.neon.tech/ovelo?sslmode=require",
  UPSTASH_REDIS_REST_URL: "https://eu1-good-1.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "AXXXtoken",
  OVELO_TRADE_SECRET: secret("t"),
  JUPITER_API_KEY: "jup-key",
  OVELO_MAX_TRADE_USDC_RAW: "50000000",
  OVELO_MAX_DAILY_USDC_RAW: "200000000",
  OVELO_BETA_GATE: "on",
  // Counsel's final terms are not in yet; a beta may run on the placeholder explicitly.
  OVELO_ALLOW_PLACEHOLDER_TERMS: "true",
  OVELO_DEPLOY_ENV: "beta",
  SENTRY_DSN: `https://${"a1".repeat(16)}@o4507.ingest.us.sentry.io/4508`,
  NEXT_PUBLIC_SENTRY_DSN: `https://${"b2".repeat(16)}@o4507.ingest.sentry.io/4509`,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: "beta",
  SENTRY_ENVIRONMENT: "beta",
  JITO_BLOCK_ENGINE_URL: "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  OVELO_REVALIDATE_SECRET: secret("r"),
  PYTH_API_KEY: "pyth",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-real",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret",
};
