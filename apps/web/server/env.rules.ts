import type { z } from "zod";
import { productionRules } from "./platform";

/** The M7 variables these rules read (a structural view of the parsed environment). */
export type InvestEnvView = {
  VERCEL_ENV?: "production" | "preview" | "development";
  VERCEL?: string;
  AROMA_PLATFORM?: string;
  AROMA_DEPLOY_ENV?: string;
  AROMA_V1_ALLOW_TEST_SWITCHES: boolean;
  NEXT_PUBLIC_AROMA_LOCALNET?: "true" | "false";
  AROMA_V1_INVEST_CLUSTER: "devnet" | "localnet";
  AROMA_V1_LOCALNET_RPC_URL?: string;
  AROMA_V1_LOCALNET_GENESIS?: string;
  AROMA_V1_LOCALNET_FUNDING_MINT?: string;
  TURNSTILE_SECRET_KEY?: string;
  NODE_ENV: "development" | "test" | "production";
  UPSTASH_REDIS_REST_URL?: string;
};

/** M7: localnet is a test-build-only cluster; production never accepts any part of it. */
export function localnetRules(env: InvestEnvView, ctx: z.RefinementCtx): void {
  const redis = env.UPSTASH_REDIS_REST_URL;
  if (redis && !redis.startsWith("https://")) {
    const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(
      redis,
    );
    const testRun =
      !productionRules(env) &&
      (env.NODE_ENV !== "production" || env.AROMA_V1_ALLOW_TEST_SWITCHES);
    if (!loopback || !testRun)
      ctx.addIssue({
        code: "custom",
        path: ["UPSTASH_REDIS_REST_URL"],
        message: "must be an https:// URL",
      });
  }
  const issue = (key: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [key], message });
  const production = productionRules(env);
  if (production) {
    if (env.NEXT_PUBLIC_AROMA_LOCALNET === "true")
      issue(
        "NEXT_PUBLIC_AROMA_LOCALNET",
        "must not be set in a production deployment",
      );
    if (env.AROMA_V1_INVEST_CLUSTER === "localnet")
      issue(
        "AROMA_V1_INVEST_CLUSTER",
        "must not be localnet in a production deployment",
      );
    for (const key of [
      "AROMA_V1_LOCALNET_RPC_URL",
      "AROMA_V1_LOCALNET_GENESIS",
      "AROMA_V1_LOCALNET_FUNDING_MINT",
    ] as const)
      if (env[key]) issue(key, "must not be set in a production deployment");
    if (
      env.TURNSTILE_SECRET_KEY &&
      TURNSTILE_TEST_SECRETS.has(env.TURNSTILE_SECRET_KEY)
    )
      issue(
        "TURNSTILE_SECRET_KEY",
        "must not be a Cloudflare test secret in production",
      );
  }
  if (env.AROMA_V1_INVEST_CLUSTER !== "localnet") return;
  if (!env.AROMA_V1_ALLOW_TEST_SWITCHES)
    issue(
      "AROMA_V1_INVEST_CLUSTER",
      "localnet needs AROMA_V1_ALLOW_TEST_SWITCHES=true",
    );
  if (env.NEXT_PUBLIC_AROMA_LOCALNET !== "true")
    issue(
      "AROMA_V1_INVEST_CLUSTER",
      "localnet needs a NEXT_PUBLIC_AROMA_LOCALNET=true build",
    );
  for (const key of [
    "AROMA_V1_LOCALNET_RPC_URL",
    "AROMA_V1_LOCALNET_GENESIS",
    "AROMA_V1_LOCALNET_FUNDING_MINT",
  ] as const)
    if (!env[key])
      issue(key, "is required when AROMA_V1_INVEST_CLUSTER=localnet");
}

/** Cloudflare's published Turnstile test secrets (always pass / always fail / token spent). */
export const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);
