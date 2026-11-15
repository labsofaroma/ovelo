import { z } from "zod";
import { MAINNET_ENV_FIELDS, mainnetEnvIssues } from "./mainnet/env";

/**
 * Keeper environment (validated at boot; values are never logged or echoed). The keeper key is a
 * DEVNET-ONLY server secret: it is refused on any genesis other than devnet's (or a local
 * validator's, in a localnet test run), checked at boot and for every RPC client. Mainnet
 * (`KEEPER_CLUSTER=mainnet`, off until M12) uses a separate key and rules: `mainnet/env.ts`.
 */

const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
const url = z.url({ message: "must be a URL" }).refine((v) => {
  const u = new URL(v);
  return !u.username && !u.password;
}, "must not embed credentials");
const httpsOrLoopback = url.refine(
  (v) => v.startsWith("https://") || LOOPBACK_HTTP.test(new URL(v).origin),
  "must be https:// (loopback http only for a local run)",
);
const keypair = z
  .string()
  .regex(
    /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/,
    "must be a 64-byte JSON array",
  );
const int = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .transform(Number)
    .refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`);

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    KEEPER_CLUSTER: z
      .enum(["devnet", "localnet", "mainnet", "mainnet-fork"])
      .default("devnet"),
    /** Local test runs only; refused when NODE_ENV=production. */
    KEEPER_ALLOW_LOCALNET: z.enum(["true", "false"]).default("false"),
    KEEPER_LOCALNET_GENESIS: z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
      .optional(),
    KEEPER_RPC_URL: httpsOrLoopback.default("https://api.devnet.solana.com"),
    /** Devnet and localnet only (mainnet/env.ts). */
    KEEPER_KEYPAIR: keypair.optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(16),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(16),
    /** The URL QStash calls (checked against the signature's `sub` claim when set). */
    KEEPER_PUBLIC_URL: httpsOrLoopback.optional(),
    HERMES_URL: httpsOrLoopback.default("https://hermes.pyth.network"),
    PYTH_API_KEY: z.string().min(1).optional(),
    UPSTASH_REDIS_REST_URL: httpsOrLoopback,
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/\S+$/, "must be a postgres:// URL"),
    OVELO_LOCAL_NEON_WS_PROXY: z.string().optional(),
    KEEPER_ALERT_WEBHOOK_URL: httpsOrLoopback.optional(),
    KEEPER_ALERT_FORMAT: z.enum(["slack", "discord"]).default("slack"),
    /** Alert when the keeper holds less than this (lamports). Default 0.5 SOL. */
    KEEPER_MIN_SOL_LAMPORTS: int(0, 1_000_000_000_000).default(500_000_000),
    KEEPER_PRIORITY_MICROLAMPORTS: int(0, 10_000_000).default(0),
    KEEPER_MAX_PLANS_PER_RUN: int(1, 500).default(25),
    /** Dead-letter entries at or above this count raise an alert. */
    KEEPER_DLQ_ALERT_THRESHOLD: int(1, 10_000).default(1),
    /** Attempts per transaction before an item is dead-lettered. */
    KEEPER_MAX_ATTEMPTS: int(1, 8).default(3),
    KEEPER_PORT: int(1, 65_535).default(8787),
    ...MAINNET_ENV_FIELDS,
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (env.KEEPER_CLUSTER === "localnet") {
      if (env.NODE_ENV === "production")
        issue("KEEPER_CLUSTER", "localnet is refused in production");
      if (env.KEEPER_ALLOW_LOCALNET !== "true")
        issue("KEEPER_CLUSTER", "localnet needs KEEPER_ALLOW_LOCALNET=true");
      if (!env.KEEPER_LOCALNET_GENESIS)
        issue("KEEPER_LOCALNET_GENESIS", "is required for localnet");
      if (!LOOPBACK_HTTP.test(new URL(env.KEEPER_RPC_URL).origin))
        issue("KEEPER_RPC_URL", "localnet needs a loopback RPC");
    } else if (env.KEEPER_CLUSTER === "devnet") {
      for (const key of [
        "KEEPER_RPC_URL",
        "UPSTASH_REDIS_REST_URL",
        "HERMES_URL",
        "KEEPER_ALERT_WEBHOOK_URL",
        "KEEPER_PUBLIC_URL",
      ] as const) {
        const value = env[key];
        if (value && !value.startsWith("https://"))
          issue(key, "must be https:// on devnet");
      }
    }
    mainnetEnvIssues(env, issue);
    if (env.QSTASH_CURRENT_SIGNING_KEY === env.QSTASH_NEXT_SIGNING_KEY)
      issue(
        "QSTASH_NEXT_SIGNING_KEY",
        "must differ from the current signing key",
      );
  });

export type KeeperEnv = z.output<typeof schema>;

export class KeeperEnvError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid keeper environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "KeeperEnvError";
  }
}

/** Parse; blank values count as unset. The error lists variable names and problems only. */
export function parseKeeperEnv(
  source: Record<string, string | undefined>,
): KeeperEnv {
  const input: Record<string, string> = {};
  for (const [key, value] of Object.entries(source))
    if (value?.trim()) input[key] = value.trim();
  const result = schema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `${String(i.path[0] ?? "environment")}: ${i.message}`,
    );
    // Cross-field checks do not run when a field fails; the devnet key is still named.
    const mainnet = /^mainnet/.test(input.KEEPER_CLUSTER ?? "");
    if (
      !mainnet &&
      !input.KEEPER_KEYPAIR &&
      !problems.some((p) => p.startsWith("KEEPER_KEYPAIR:"))
    )
      problems.unshift("KEEPER_KEYPAIR: is required");
    throw new KeeperEnvError(problems);
  }
  return result.data;
}
