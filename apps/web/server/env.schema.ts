import { z } from "zod";
import { localnetRules } from "./env.rules";
export { TURNSTILE_TEST_SECRETS } from "./env.rules";

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
  /** E2E builds only: compiles in the test wallet bridge (no key material). Never in production. */
  NEXT_PUBLIC_AROMA_E2E_WALLET: z.enum(["true", "false"]).optional(),
  /** M7: browser RPC for `/v1/invest` on devnet (default: Solana's public devnet endpoint). */
  NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL: httpsUrl.optional(),
  /**
   * M7, test builds only: compiles in the localnet wallet cluster (local-validator E2E). Refused
   * in production here and by the client-secret scan.
   */
  NEXT_PUBLIC_AROMA_LOCALNET: z.enum(["true", "false"]).optional(),
  /** M7: Cloudflare Turnstile site key for the devnet faucet (public). */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalText,
};

const serverShape = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  AROMA_V1_ENABLED: bool.default(false),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /** HTTPS mainnet RPC. Loopback http is accepted only for an E2E local fork (see superRefine). */
  SOLANA_RPC_URL: z
    .url({ message: "must be a URL" })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    }, "must not embed credentials")
    .optional(),
  DATABASE_URL: postgresUrl.optional(),
  UPSTASH_REDIS_REST_URL: httpsUrl.optional(),
  UPSTASH_REDIS_REST_TOKEN: optionalText,
  AROMA_TRADE_SECRET: secret32.optional(),
  /** The previous trade secret during a rotation: quotes signed with it still verify until they expire. */
  AROMA_TRADE_SECRET_PREVIOUS: secret32.optional(),
  /** Jito Block Engine bundle endpoint. Unset: multi-transaction baskets are refused (no partial orders). */
  JITO_BLOCK_ENGINE_URL: httpsUrl.optional(),
  JITO_AUTH_UUID: optionalText,
  JITO_MAX_TIP_LAMPORTS: z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .refine((v) => Number(v) >= 1000 && Number(v) <= 100_000, {
      message: "must be between 1000 and 100000",
    })
    .optional(),
  AROMA_SITE_URL: httpsUrl.optional(),
  AROMA_ALLOWED_ORIGINS: optionalText,
  AROMA_TRUST_PROXY: bool.default(false),
  JUPITER_API_KEY: optionalText,
  PYTH_API_KEY: optionalText,
  PRIVY_APP_SECRET: optionalText,
  CREATOR_AUTH_SECRET: secret32.optional(),
  /** Bearer secret for POST /api/v1/revalidate (M3). Unset: the route answers 503. */
  AROMA_REVALIDATE_SECRET: secret32.optional(),
  SENTRY_DSN: httpsUrl.optional(),
  SENTRY_ENVIRONMENT: optionalText,
  /** Set by Vercel: "production" | "preview" | "development". */
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  /**
   * Lets a local `next start` (NODE_ENV=production) honour test-only switches such as
   * AROMA_V1_SIMULATE_UPSTREAM_OUTAGE. Rejected outright when VERCEL_ENV=production.
   */
  AROMA_V1_ALLOW_TEST_SWITCHES: bool.default(false),
  /**
   * E2E only (test switches): genesis hash of a LOCAL fork (solana-test-validator) that stands in
   * for mainnet. Honoured only with a loopback SOLANA_RPC_URL while test switches are allowed.
   */
  AROMA_V1_TEST_FORK_GENESIS: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 hash")
    .optional(),
  /** E2E only (test switches): a loopback Jupiter stand-in serving recorded routes. */
  AROMA_V1_TEST_JUPITER_URL: z
    .url({ message: "must be a URL" })
    .refine((v) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(v), {
      message: "must be a loopback http URL",
    })
    .optional(),
};

const loopbackHttp = z
  .url({ message: "must be a URL" })
  .refine((v) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(v), {
    message: "must be a loopback http URL",
  });
const base58Hash = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be base58");

const devnetShape = {
  /** Server devnet RPC (prototype and, from M7, `/v1/invest` on devnet). Genesis-checked per client. */
  AROMA_RECURRING_RPC_URL: z.url().optional(),
  AROMA_RECURRING_AUTH_SECRET: secret32.optional(),
  AROMA_FAUCET_SECRET_KEY: optionalText,
  /**
   * M7: the cluster `/v1/invest` runs on. `localnet` (a local validator) is for test builds only:
   * it needs test switches and the localnet build flag, and is refused in production.
   */
  AROMA_V1_INVEST_CLUSTER: z.enum(["devnet", "localnet"]).default("devnet"),
  /** M7 localnet only: the validator's RPC, its genesis hash and the test USD mint. */
  AROMA_V1_LOCALNET_RPC_URL: loopbackHttp.optional(),
  AROMA_V1_LOCALNET_GENESIS: base58Hash.optional(),
  AROMA_V1_LOCALNET_FUNDING_MINT: base58Hash.optional(),
  /**
   * M7 faucet: the devnet-only key that holds the test USD mint authority (never the deployer),
   * as a 64-byte JSON array. Refused on any non-devnet genesis at use.
   */
  AROMA_V1_FAUCET_KEYPAIR: z
    .string()
    .regex(
      /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/,
      "must be a 64-byte JSON array",
    )
    .optional(),
  /** M7 faucet: Cloudflare Turnstile secret (server-side siteverify). */
  TURNSTILE_SECRET_KEY: optionalText,
  /** M7 faucet: claims allowed per UTC day across all wallets (default 200). */
  AROMA_V1_FAUCET_DAILY_CLAIMS: z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .refine((v) => Number(v) >= 1 && Number(v) <= 10_000, {
      message: "must be between 1 and 10000",
    })
    .optional(),
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
  if (env.VERCEL_ENV === "production") {
    for (const key of [
      "AROMA_V1_ALLOW_TEST_SWITCHES",
      "AROMA_V1_TEST_FORK_GENESIS",
      "AROMA_V1_TEST_JUPITER_URL",
    ] as const) {
      if (env[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "must not be set in a production deployment",
        });
    }
  }
  if (
    env.VERCEL_ENV === "production" &&
    env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true"
  )
    ctx.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_AROMA_E2E_WALLET"],
      message: "must not be set in a production deployment",
    });
  localnetRules(env, ctx);
  if (env.SOLANA_RPC_URL && !env.SOLANA_RPC_URL.startsWith("https://")) {
    const loopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(
      env.SOLANA_RPC_URL,
    );
    if (!loopback || !env.AROMA_V1_TEST_FORK_GENESIS)
      ctx.addIssue({
        code: "custom",
        path: ["SOLANA_RPC_URL"],
        message: "must be an https:// URL",
      });
  }
  if (
    env.AROMA_TRADE_SECRET_PREVIOUS &&
    env.AROMA_TRADE_SECRET_PREVIOUS === env.AROMA_TRADE_SECRET
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["AROMA_TRADE_SECRET_PREVIOUS"],
      message: "must differ from AROMA_TRADE_SECRET",
    });
  }
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

/**
 * Whether test-only switches (outage simulation, M3; the E2E wallet, M4) may take effect. Always in
 * development and test. Under NODE_ENV=production only for a local `next start` that opts in with
 * AROMA_V1_ALLOW_TEST_SWITCHES=true, and never on a Vercel production deployment.
 */
export function testSwitchesAllowed(
  source: Record<string, string | undefined>,
): boolean {
  if (source.VERCEL_ENV?.trim() === "production") return false;
  if (source.NODE_ENV !== "production") return true;
  return source.AROMA_V1_ALLOW_TEST_SWITCHES?.trim() === "true";
}

/** Throws EnvValidationError (a readable list of variable names and problems) when invalid. */
export function validateEnv(source: Record<string, string | undefined>): Env {
  const result = parseEnv(source);
  if (!result.ok) throw result.error;
  return result.env;
}
