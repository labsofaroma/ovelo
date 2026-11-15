export function publicEnvOf(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string>;
export function applyPublicEnv(
  env: Record<string, string | undefined>,
  baked: Readonly<Record<string, unknown>>,
): string[];
