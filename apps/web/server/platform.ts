/**
 * Phase H: the ONE place that answers "which platform, which deploy environment, and do the
 * production rules apply". Every other module asks here; `process.env.VERCEL*` is read nowhere
 * else (lint rule in packages/config/eslint, AGENTS.md).
 *
 * - Vercel (`VERCEL=1` or `VERCEL_ENV` set): the deploy environment is `VERCEL_ENV`, as before
 *   Phase H. `AROMA_DEPLOY_ENV` may only refine `production` into `beta`; anything else that
 *   disagrees with `VERCEL_ENV` is a contradiction.
 * - Self-host: `AROMA_PLATFORM=selfhost` and `AROMA_DEPLOY_ENV` are both required.
 * - `NODE_ENV=production` with no platform answer is refused (`next build` alone is exempt:
 *   building is not a deployment, and the runtime boot validates again).
 *
 * Fail closed: whenever the answer is missing or inconsistent, `productionRules` is true, so
 * every caller applies the strictest rules, and `platformProblems` makes the boot refuse.
 * Pure and dependency-free, so middleware, scripts and the env schema can all import it.
 */

export type Platform = "vercel" | "selfhost";
export type DeployEnv = "production" | "beta" | "preview" | "development";

export type PlatformProblem = { variable: string; problem: string };

export type PlatformAnswer = {
  /** null only when nothing identifies a platform (local development, tests, `next build`). */
  platform: Platform | null;
  deployEnv: DeployEnv;
  /** True for production and beta, and whenever the answer is missing or inconsistent. */
  productionRules: boolean;
  problems: readonly PlatformProblem[];
};

/** Any environment-like record (raw `process.env`, or the parsed env schema output). */
type EnvLike = Readonly<Record<string, unknown>>;

const PLATFORMS: readonly Platform[] = ["vercel", "selfhost"];
const DEPLOY_ENVS: readonly DeployEnv[] = [
  "production",
  "beta",
  "preview",
  "development",
];
const VERCEL_ENVS = ["production", "preview", "development"] as const;
const BUILD_PHASE = "phase-production-build";

function text(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolvePlatform(env: EnvLike): PlatformAnswer {
  const problems: PlatformProblem[] = [];
  const problem = (variable: string, message: string) =>
    problems.push({ variable, problem: message });

  const declared = text(env, "AROMA_PLATFORM");
  const deployRaw = text(env, "AROMA_DEPLOY_ENV");
  const vercelFlag = text(env, "VERCEL");
  const vercelEnvRaw = text(env, "VERCEL_ENV");
  const nodeProduction = text(env, "NODE_ENV") === "production";
  const building = text(env, "NEXT_PHASE") === BUILD_PHASE;

  if (declared && !PLATFORMS.includes(declared as Platform))
    problem("AROMA_PLATFORM", "must be vercel or selfhost");
  if (deployRaw && !DEPLOY_ENVS.includes(deployRaw as DeployEnv))
    problem(
      "AROMA_DEPLOY_ENV",
      "must be production, beta, preview or development",
    );
  const deploy = DEPLOY_ENVS.includes(deployRaw as DeployEnv)
    ? (deployRaw as DeployEnv)
    : undefined;

  const onVercel = vercelFlag === "1" || vercelEnvRaw !== undefined;
  if (vercelFlag !== undefined && vercelFlag !== "1")
    problem("VERCEL", "must be 1 when set");
  const vercelEnv = (VERCEL_ENVS as readonly string[]).includes(
    vercelEnvRaw ?? "",
  )
    ? (vercelEnvRaw as (typeof VERCEL_ENVS)[number])
    : undefined;
  if (vercelEnvRaw && !vercelEnv)
    problem("VERCEL_ENV", "must be production, preview or development");

  let platform: Platform | null = null;
  let deployEnv: DeployEnv = "development";

  if (onVercel) {
    platform = "vercel";
    if (declared === "selfhost")
      problem("AROMA_PLATFORM", "is selfhost but this is a Vercel deployment");
    if (vercelEnv) deployEnv = vercelEnv;
    else if (!vercelEnvRaw && nodeProduction)
      problem("VERCEL_ENV", "is required on Vercel in production");
    if (deploy && deploy !== deployEnv) {
      if (deploy === "beta" && deployEnv === "production") deployEnv = "beta";
      else
        problem(
          "AROMA_DEPLOY_ENV",
          `contradicts VERCEL_ENV (${vercelEnv ?? "unset"})`,
        );
    }
  } else if (declared === "vercel") {
    platform = "vercel";
    problem("AROMA_PLATFORM", "is vercel but VERCEL and VERCEL_ENV are unset");
  } else if (declared === "selfhost") {
    platform = "selfhost";
    if (deploy) deployEnv = deploy;
    else if (!deployRaw)
      problem("AROMA_DEPLOY_ENV", "is required when AROMA_PLATFORM=selfhost");
  } else if (!declared) {
    if (deployRaw)
      problem("AROMA_PLATFORM", "is required when AROMA_DEPLOY_ENV is set");
    else if (nodeProduction && !building)
      problem(
        "AROMA_PLATFORM",
        "is required in production (selfhost, with AROMA_DEPLOY_ENV; Vercel sets VERCEL_ENV)",
      );
  }

  const unanswered = platform === null && nodeProduction;
  return {
    platform,
    deployEnv,
    productionRules:
      problems.length > 0 ||
      unanswered ||
      deployEnv === "production" ||
      deployEnv === "beta",
    problems,
  };
}

/** Whether the production rules apply (fail closed: true when the answer is missing or bad). */
export function productionRules(env: EnvLike): boolean {
  return resolvePlatform(env).productionRules;
}

/** The deploy environment, for naming (Sentry, logs). Never use it to relax a rule. */
export function deployEnvOf(env: EnvLike): DeployEnv {
  return resolvePlatform(env).deployEnv;
}

/** Problems that must stop the boot (and `check:prod-env`). Empty when the answer is sound. */
export function platformProblems(env: EnvLike): readonly PlatformProblem[] {
  return resolvePlatform(env).problems;
}

/** Vercel's production host (`VERCEL_PROJECT_PRODUCTION_URL`), the site URL fallback on Vercel only. */
export function vercelProductionHost(env: EnvLike): string | undefined {
  return text(env, "VERCEL_PROJECT_PRODUCTION_URL");
}

/**
 * Whether this runs on Vercel by its own `VERCEL=1` flag (the pre-Phase-H proxy-trust input,
 * unchanged). Phase H Step 2 replaces proxy trust with AROMA_PROXY_MODE.
 */
export function vercelFlag(env: EnvLike): boolean {
  return text(env, "VERCEL") === "1";
}
