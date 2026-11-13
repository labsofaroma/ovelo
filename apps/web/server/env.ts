import "server-only";
import { type Env, parseEnv, type EnvResult } from "./env.schema";

export { EnvValidationError, type Env } from "./env.schema";

let cached: EnvResult | undefined;

/** Memoised, validated server environment. Throws EnvValidationError with variable names only. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  if (!cached.ok) throw cached.error;
  return cached.env;
}

/** Non-throwing variant for health checks and boot diagnostics. */
export function tryGetEnv(): EnvResult {
  cached ??= parseEnv(process.env);
  return cached;
}

/** True when the v1 foundation is switched on (see AROMA_V1_ENABLED in .env.example). */
export function isV1Enabled(): boolean {
  return process.env.AROMA_V1_ENABLED?.trim() === "true";
}

/**
 * Boot-time hook, called from instrumentation.ts. When v1 is enabled, an invalid or incomplete
 * environment stops the process: the variable names and problems go to stderr and the process
 * exits with code 1, so the platform never routes traffic to a half-configured instance. (Next.js
 * would otherwise keep serving and fail every request.) When v1 is off (the deployed prototype)
 * this does nothing, so the prototype keeps booting without the v1 services configured.
 */
export function assertBootEnv(): void {
  if (!isV1Enabled()) return;
  const result = tryGetEnv();
  if (!result.ok) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
}

/** Test helper: forget the memoised result. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
