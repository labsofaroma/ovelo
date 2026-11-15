import { vi } from "vitest";

/**
 * The always-required variables (server/env.schema.ts REQUIRED), with test placeholders. M9: the
 * old v1 feature flag is gone, so every environment a test parses or boots needs them.
 */
export const BASE_ENV = {
  SOLANA_RPC_URL: "https://mainnet.example-rpc.test/k",
  DATABASE_URL: "postgres://u:p@db.example.test/ovelo?sslmode=require",
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
  OVELO_TRADE_SECRET: "test-trade-secret-not-for-production-0123456789",
  // Required on every production parse (W3); the beta values.
  OVELO_MAX_TRADE_USDC_RAW: "50000000",
  OVELO_MAX_DAILY_USDC_RAW: "200000000",
} as const;

/** vi.stubEnv each required variable (call in beforeEach; vi.unstubAllEnvs restores them). */
export function stubBaseEnv(): void {
  for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
}
