import { z } from "zod";
import { betaShape, capRules } from "./env.beta";
import { complianceShape } from "./env.compliance";
import { localnetRules } from "./env.rules";
import { feeShape } from "./env.fees";
import { notifyRules, notifyShape } from "./env.notify";
import { termsRules, termsShape } from "./env.terms";
import { sentryDsn } from "./env.sentry";
import { platformRules, platformShape } from "./env.platform";
import { productionRules } from "./platform";
export { TURNSTILE_TEST_SECRETS } from "./env.rules";
export { testSwitchesAllowed } from "./env.platform";

/**
 * Pure environment schema (no `server-only`, no I/O) so it can be reused by the boot hook,
 * the build-time check script and unit tests. Values are NEVER included in error output.
 *
 * Variables are grouped as public, server, devnet and keeper. The REQUIRED variables always apply
 * (M9: the old v1 feature flag is gone); format rules apply to any variable that is set.
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
  NEXT_PUBLIC_SOLANA_RPC_URL: httpsUrl.optional(),
  NEXT_PUBLIC_SOLANA_WS_URL: z
    .url({ protocol: /^wss$/, message: "must be a wss:// URL" })
    .optional(),
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: optionalText,
  /** W4: a real DSN carries its public key as userinfo; see env.sentry.ts. */
  NEXT_PUBLIC_SENTRY_DSN: sentryDsn.optional(),
  /** E2E builds only: compiles in the test wallet bridge (no key material). Never in production. */
  NEXT_PUBLIC_OVELO_E2E_WALLET: z.enum(["true", "false"]).optional(),
  /** M7: browser RPC for `/invest` on devnet (default: Solana's public devnet endpoint). */
  NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL: httpsUrl.optional(),
  /**
   * M7, test builds only: compiles in the localnet wallet cluster (local-validator E2E). Refused
   * in production here and by the client-secret scan.
   */
  NEXT_PUBLIC_OVELO_LOCALNET: z.enum(["true", "false"]).optional(),
  /** M7: Cloudflare Turnstile site key for the devnet faucet (public). */
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalText,
  /** WalletConnect (Reown) project ID (public): QR and phone-wallet connections. Unset: none. */
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z
    .string()
    .regex(/^[0-9a-f]{32}$/, "must be a 32-character hex project ID")
    .optional(),
};

/**
 * A server RPC URL without credentials. zod 4 runs `.refine` even after `.url()` failed, so the
 * credential check must not throw on a non-URL (it reports "must be a URL" instead).
 */
const rpcUrl = z.url({ message: "must be a URL" }).refine((value) => {
  if (!URL.canParse(value)) return true;
  const url = new URL(value);
  return !url.username && !url.password;
}, "must not embed credentials");

const serverShape = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /** M9 emergency stop: `off` refuses every mainnet trading entry point (503). Default on. */
  OVELO_TRADING: z.enum(["on", "off"]).default("on"),
  /** Solana Actions POST: unset = off under the production rules, on elsewhere (server/actions-switch.ts). */
  OVELO_ACTIONS: z.enum(["on", "off"]).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /** HTTPS mainnet RPC. Loopback http is accepted only for an E2E local fork (see superRefine). */
  SOLANA_RPC_URL: rpcUrl.optional(),
  /**
   * M9 failover: a second mainnet RPC (another provider), same rules as SOLANA_RPC_URL, and it
   * must differ from it. Its genesis is verified on its own at runtime (features/trade/server).
   */
  SOLANA_RPC_FALLBACK_URL: rpcUrl.optional(),
  DATABASE_URL: postgresUrl.optional(),
  /** HTTPS; a loopback http URL only for a local run with test switches (M7 local Redis proxy). */
  UPSTASH_REDIS_REST_URL: z
    .url({ message: "must be a URL" })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    }, "must not embed credentials")
    .optional(),
  UPSTASH_REDIS_REST_TOKEN: optionalText,
  OVELO_TRADE_SECRET: secret32.optional(),
  /** The previous trade secret during a rotation: quotes signed with it still verify until they expire. */
  OVELO_TRADE_SECRET_PREVIOUS: secret32.optional(),
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
  OVELO_SITE_URL: httpsUrl.optional(),
  OVELO_ALLOWED_ORIGINS: optionalText,
  JUPITER_API_KEY: optionalText,
  PYTH_API_KEY: optionalText,
  /** Bearer secret for POST /api/v1/revalidate (M3). Unset: the route answers 503. */
  OVELO_REVALIDATE_SECRET: secret32.optional(),
  SENTRY_DSN: sentryDsn.optional(),
  SENTRY_ENVIRONMENT: optionalText,
  ...platformShape,
  /**
   * Lets a local `next start` (NODE_ENV=production) honour test-only switches such as
   * OVELO_V1_SIMULATE_UPSTREAM_OUTAGE. Rejected outright when the production rules apply
   * (server/platform.ts: production or beta, or no sound platform answer).
   */
  OVELO_V1_ALLOW_TEST_SWITCHES: bool.default(false),
  /**
   * E2E only (test switches): genesis hash of a LOCAL fork (solana-test-validator) that stands in
   * for mainnet. Honoured only with a loopback SOLANA_RPC_URL while test switches are allowed.
   */
  OVELO_V1_TEST_FORK_GENESIS: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 hash")
    .optional(),
  /** E2E only (test switches): a loopback Jupiter stand-in serving recorded routes. */
  OVELO_V1_TEST_JUPITER_URL: z
    .url({ message: "must be a URL" })
    .refine((v) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(v), {
      message: "must be a loopback http URL",
    })
    .optional(),
  // --- M9 compliance gate (additive) ---
  ...complianceShape,
  // --- end M9 compliance gate ---
  // --- Phase A private beta (W2, W3) ---
  ...betaShape,
  ...notifyShape, // M11 notifications
  ...termsShape, // launch gate: counsel's final terms
  ...feeShape, // M11 fee-share ledger (accounting only)
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
  /** Server devnet RPC (prototype and, from M7, `/invest` on devnet). Genesis-checked per client. */
  OVELO_RECURRING_RPC_URL: z.url().optional(),
  /**
   * M7: the cluster `/invest` runs on. `localnet` (a local validator) is for test builds only:
   * it needs test switches and the localnet build flag, and is refused in production.
   */
  OVELO_V1_INVEST_CLUSTER: z.enum(["devnet", "localnet"]).default("devnet"),
  /** M7 localnet only: the validator's RPC, its genesis hash and the test USD mint. */
  OVELO_V1_LOCALNET_RPC_URL: loopbackHttp.optional(),
  OVELO_V1_LOCALNET_GENESIS: base58Hash.optional(),
  OVELO_V1_LOCALNET_FUNDING_MINT: base58Hash.optional(),
  /**
   * M7 faucet: the devnet-only key that holds the test USD mint authority (never the deployer),
   * as a 64-byte JSON array. Refused on any non-devnet genesis at use.
   */
  OVELO_V1_FAUCET_KEYPAIR: z
    .string()
    .regex(
      /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/,
      "must be a 64-byte JSON array",
    )
    .optional(),
  /** M7 faucet: Cloudflare Turnstile secret (server-side siteverify). */
  TURNSTILE_SECRET_KEY: optionalText,
  /** M7 faucet: claims allowed per UTC day across all wallets (default 200). */
  OVELO_V1_FAUCET_DAILY_CLAIMS: z
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
  OVELO_RECURRING_EXECUTOR_SECRET: secret32.optional(),
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

/** Every variable the v1 schema reads (check:prod-env's beta profile flags the others). */
export const SCHEMA_VARIABLES: readonly string[] = Object.keys(flatShape);

/** Always required (M9: no feature flag; OVELO_SKIP_ENV_CHECK only for local builds). */
export const REQUIRED = [
  "SOLANA_RPC_URL",
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "OVELO_TRADE_SECRET",
] as const;

/** Same URL after normalisation; false when either is not a URL (its own field reports that). */
function sameUrl(a: string, b: string): boolean {
  return (
    URL.canParse(a) && URL.canParse(b) && new URL(a).href === new URL(b).href
  );
}

const flatSchema = z.object(flatShape).superRefine((env, ctx) => {
  platformRules(env, ctx); // Phase H: server/platform.ts
  const production = productionRules(env);
  if (production) {
    for (const key of [
      "OVELO_V1_ALLOW_TEST_SWITCHES",
      "OVELO_V1_TEST_FORK_GENESIS",
      "OVELO_V1_TEST_JUPITER_URL",
    ] as const) {
      if (env[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "must not be set in a production deployment",
        });
    }
  }
  if (production && env.NEXT_PUBLIC_OVELO_E2E_WALLET === "true")
    ctx.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_OVELO_E2E_WALLET"],
      message: "must not be set in a production deployment",
    });
  localnetRules(env, ctx);
  capRules(env, ctx);
  notifyRules(env, ctx);
  termsRules(env, ctx);
  const isLoopback = (value: string) =>
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(value);
  for (const key of ["SOLANA_RPC_URL", "SOLANA_RPC_FALLBACK_URL"] as const) {
    const value = env[key];
    if (!value || value.startsWith("https://")) continue;
    // Loopback http only for the declared local fork; a loopback fallback only next to a
    // loopback (fork) primary, as features/trade/server/rpc.ts accepts at runtime.
    const forkAllowed =
      isLoopback(value) &&
      Boolean(env.OVELO_V1_TEST_FORK_GENESIS) &&
      (key === "SOLANA_RPC_URL" ||
        (env.SOLANA_RPC_URL !== undefined && isLoopback(env.SOLANA_RPC_URL)));
    if (!forkAllowed)
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "must be an https:// URL",
      });
  }
  if (
    env.SOLANA_RPC_FALLBACK_URL &&
    sameUrl(
      env.SOLANA_RPC_FALLBACK_URL,
      env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    )
  )
    ctx.addIssue({
      code: "custom",
      path: ["SOLANA_RPC_FALLBACK_URL"],
      message: "must differ from SOLANA_RPC_URL",
    });
  if (
    env.OVELO_TRADE_SECRET_PREVIOUS &&
    env.OVELO_TRADE_SECRET_PREVIOUS === env.OVELO_TRADE_SECRET
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["OVELO_TRADE_SECRET_PREVIOUS"],
      message: "must differ from OVELO_TRADE_SECRET",
    });
  }
  for (const key of REQUIRED) {
    if (env[key] === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "is required",
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
