import { z } from "zod";
import { platformProblems, productionRules } from "./platform";
import { proxyProblems } from "./proxy";

/**
 * Phase H: the platform variables in the boot schema. They are validated by server/platform.ts
 * (the one place that interprets them), so here they are plain optional text.
 */
const optionalText = z.string().min(1).optional();

export const platformShape = {
  /** Set by Vercel: "production" | "preview" | "development". Read only by server/platform.ts. */
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  /** Set by Vercel to "1". Read only by server/platform.ts. */
  VERCEL: optionalText,
  /** `vercel` | `selfhost`. Required off Vercel in production. */
  AROMA_PLATFORM: optionalText,
  /** `production` | `beta` | `preview` | `development`. Required with selfhost. */
  AROMA_DEPLOY_ENV: optionalText,
  /** Set by Next during `next build` (the build is exempt from the platform requirement). */
  NEXT_PHASE: optionalText,
  /** `vercel` | `cloudflare` | `none` (server/proxy.ts). Default: vercel on Vercel, else none. */
  AROMA_PROXY_MODE: optionalText,
  /** Secret the Cloudflare Transform Rule sends as x-aroma-origin (cloudflare mode, ≥ 32 chars). */
  AROMA_ORIGIN_SECRET: optionalText,
  /** Removed in Phase H: kept in the shape only so the boot can name it and refuse it. */
  AROMA_TRUST_PROXY: optionalText,
};

type Ctx = {
  addIssue(issue: { code: "custom"; path: string[]; message: string }): void;
};

/** A missing or contradictory platform or proxy answer stops the boot (fail closed). */
export function platformRules(
  env: Readonly<Record<string, unknown>>,
  ctx: Ctx,
): void {
  for (const { variable, problem } of [
    ...platformProblems(env),
    ...proxyProblems(env),
  ])
    ctx.addIssue({ code: "custom", path: [variable], message: problem });
}

/**
 * Whether test-only switches (outage simulation, M3; the E2E wallet, M4) may take effect. Always in
 * development and test. Under NODE_ENV=production only for a local `next start` that opts in with
 * AROMA_V1_ALLOW_TEST_SWITCHES=true, and never when the production rules apply (server/platform.ts).
 */
export function testSwitchesAllowed(
  source: Readonly<Record<string, unknown>>,
): boolean {
  if (productionRules(source)) return false;
  if (source.NODE_ENV !== "production") return true;
  // A raw environment holds "true"; the parsed env schema output holds a boolean.
  const optIn = source.AROMA_V1_ALLOW_TEST_SWITCHES;
  return (
    optIn === true || (typeof optIn === "string" && optIn.trim() === "true")
  );
}
