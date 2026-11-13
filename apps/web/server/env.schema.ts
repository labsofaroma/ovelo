import { z } from "zod";

/**
 * Pure environment schema (no `server-only`, no I/O) so it can be reused by the boot hook,
 * the build-time check script and unit tests. Values are NEVER included in error output.
 *
 * Variables are grouped as public, server, devnet and keeper. The v1 foundation is gated by
 * AROMA_V1_ENABLED: the deployed prototype has none of the v1 services configured, so the
 * "required" rules below only apply once that flag is on. Format rules always apply to any
 * variable that is set.
 */

const optionalText = z.string().min(1).optional();
const httpsUrl = z
  .url({ protocol: /^https$/, message: "must be an https:// URL" })
  .refine(
    (value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    },
    { message: "must not embed credentials" },
  );
const secret32 = z.string().min(32, "must be at least 32 characters");
const bool = z.enum(["true", "false"]).transform((value) => value === "true");
const postgresUrl = z
  .url({ message: "must be a postgres:// URL" })
  .refine((value) => /^postgres(ql)?:\/\//.test(value), {
    message: "must be a postgres:// URL",
  });

const publicShape = {
  NEXT_PUBLIC_PRIVY_APP_ID: optionalText,
  NEXT_PUBLIC_SOLANA_RPC_URL: httpsUrl.optional(),
  NEXT_PUBLIC_SOLANA_WS_URL: z
    .url({ protocol: /^wss$/, message: "must be a wss:// URL" })
    .optional(),
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: optionalText,
  NEXT_PUBLIC_SENTRY_DSN: httpsUrl.optional(),
};

const serverShape = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  AROMA_V1_ENABLED: bool.default(false),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SOLANA_RPC_URL: httpsUrl.optional(),
  DATABASE_URL: postgresUrl.optional(),
  UPSTASH_REDIS_REST_URL: httpsUrl.optional(),
  UPSTASH_REDIS_REST_TOKEN: optionalText,
  AROMA_TRADE_SECRET: secret32.optional(),
  AROMA_SITE_URL: httpsUrl.optional(),
  AROMA_ALLOWED_ORIGINS: optionalText,
  AROMA_TRUST_PROXY: bool.default(false),
  JUPITER_API_KEY: optionalText,
  PYTH_API_KEY: optionalText,
  PRIVY_APP_SECRET: optionalText,
  CREATOR_AUTH_SECRET: secret32.optional(),
  SENTRY_DSN: httpsUrl.optional(),
  SENTRY_ENVIRONMENT: optionalText,
};

const devnetShape = {
  AROMA_RECURRING_RPC_URL: z.url().optional(),
  AROMA_RECURRING_AUTH_SECRET: secret32.optional(),
  AROMA_FAUCET_SECRET_KEY: optionalText,
};

const keeperShape = {
  QSTASH_TOKEN: optionalText,
  QSTASH_CURRENT_SIGNING_KEY: optionalText,
  QSTASH_NEXT_SIGNING_KEY: optionalText,
  AROMA_RECURRING_EXECUTOR_SECRET: secret32.optional(),
  KEEPER_ALERT_WEBHOOK_URL: httpsUrl.optional(),
};

const flatShape = {
  ...publicShape,
  ...serverShape,
  ...devnetShape,
  ...keeperShape,
};
type Group = "public" | "server" | "devnet" | "keeper";

const GROUP_OF: Record<string, Group> = {};
for (const key of Object.keys(publicShape)) GROUP_OF[key] = "public";
for (const key of Object.keys(serverShape)) GROUP_OF[key] = "server";
for (const key of Object.keys(devnetShape)) GROUP_OF[key] = "devnet";
for (const key of Object.keys(keeperShape)) GROUP_OF[key] = "keeper";

/** Required once AROMA_V1_ENABLED=true. */
export const V1_REQUIRED = [
  "SOLANA_RPC_URL",
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "AROMA_TRADE_SECRET",
] as const;

const flatSchema = z.object(flatShape).superRefine((env, ctx) => {
  if (!env.AROMA_V1_ENABLED) return;
  for (const key of V1_REQUIRED) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "is required when AROMA_V1_ENABLED=true",
      });
    }
  }
});

export type Env = {
  public: Pick<z.output<typeof flatSchema>, keyof typeof publicShape>;
  server: Pick<z.output<typeof flatSchema>, keyof typeof serverShape>;
  devnet: Pick<z.output<typeof flatSchema>, keyof typeof devnetShape>;
  keeper: Pick<z.output<typeof flatSchema>, keyof typeof keeperShape>;
};

export type EnvIssue = {
  variable: string;
  group: Group | "unknown";
  problem: string;
};

export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];
  constructor(issues: readonly EnvIssue[]) {
    const lines = issues.map(
      (i) => `  - ${i.variable} (${i.group}): ${i.problem}`,
    );
    super(`Invalid environment configuration:\n${lines.join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function pick<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  keys: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(keys)) out[key] = source[key];
  return out as T;
}

export type EnvResult =
  { ok: true; env: Env } | { ok: false; error: EnvValidationError };

/** Validate a raw environment. Blank values count as unset. Pure; never logs or echoes values. */
export function parseEnv(
  source: Record<string, string | undefined>,
): EnvResult {
  const input: Record<string, string> = {};
  for (const key of Object.keys(flatShape)) {
    const value = source[key]?.trim();
    if (value) input[key] = value;
  }
  const result = flatSchema.safeParse(input);
  if (!result.success) {
    const issues: EnvIssue[] = result.error.issues.map((issue) => {
      const variable = String(issue.path[0] ?? "environment");
      return {
        variable,
        group: GROUP_OF[variable] ?? "unknown",
        problem: issue.message,
      };
    });
    return { ok: false, error: new EnvValidationError(issues) };
  }
  const flat = result.data;
  return {
    ok: true,
    env: {
      public: pick(flat, publicShape),
      server: pick(flat, serverShape),
      devnet: pick(flat, devnetShape),
      keeper: pick(flat, keeperShape),
    },
  };
}

/** Throws EnvValidationError (a readable list of variable names and problems) when invalid. */
export function validateEnv(source: Record<string, string | undefined>): Env {
  const result = parseEnv(source);
  if (!result.ok) throw result.error;
  return result.env;
}
