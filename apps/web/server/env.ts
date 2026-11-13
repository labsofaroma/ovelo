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
 * environment stops the server from starting. When it is off (the deployed prototype), this does
 * nothing, so the prototype keeps booting without the v1 services configured.
 */
export function assertBootEnv(): void {
  if (isV1Enabled()) getEnv();
}

/** Test helper: forget the memoised result. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
