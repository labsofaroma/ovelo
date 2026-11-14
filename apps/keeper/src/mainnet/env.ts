import { z } from "zod";

/**
 * Mainnet keeper environment (M8 B5). `KEEPER_CLUSTER=mainnet` is OFF everywhere until M12: no
 * deploy config sets it. It needs its own key, `KEEPER_MAINNET_KEYPAIR`, and refuses to start
 * when the devnet key (`KEEPER_KEYPAIR`) is present, so the devnet key can never sign on mainnet
 * (and the mainnet key is refused on devnet and localnet). `mainnet-fork` is the local-fork test
 * mode (M8 B4): never in production, opt-in, a loopback RPC and the fork's own genesis.
 */

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
const keypair = z
  .string()
  .regex(
    /^\[\s*\d{1,3}(\s*,\s*\d{1,3}){63}\s*\]$/,
    "must be a 64-byte JSON array",
  );
const url = z.url({ message: "must be a URL" }).refine((v) => {
  const u = new URL(v);
  return !u.username && !u.password;
}, "must not embed credentials");
const int = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .transform(Number)
    .refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`);

export const MAINNET_CLUSTERS = ["mainnet", "mainnet-fork"] as const;
export type MainnetCluster = (typeof MAINNET_CLUSTERS)[number];
export const isMainnetCluster = (cluster: string): cluster is MainnetCluster =>
  (MAINNET_CLUSTERS as readonly string[]).includes(cluster);

export const MAINNET_ENV_FIELDS = {
  KEEPER_MAINNET_KEYPAIR: keypair.optional(),
  KEEPER_ALLOW_FORK: z.enum(["true", "false"]).default("false"),
  KEEPER_FORK_GENESIS: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .optional(),
  KEEPER_JUPITER_URL: url.default("https://api.jup.ag"),
  JUPITER_API_KEY: z.string().min(1).optional(),
  /** Optional Jito block-engine `sendTransaction` URL; a tip goes in each transaction. */
  KEEPER_JITO_URL: url.optional(),
  KEEPER_JITO_TIP_LAMPORTS: int(0, 100_000_000).default(0),
  /** Routed legs per execute transaction (three routed legs exceed one transaction, M8). */
  KEEPER_MAINNET_LEGS_PER_TX: int(1, 2).default(2),
};

type Fields = {
  NODE_ENV: string;
  KEEPER_CLUSTER: string;
  KEEPER_KEYPAIR?: string;
  KEEPER_RPC_URL: string;
  HERMES_URL: string;
  PYTH_API_KEY?: string;
  UPSTASH_REDIS_REST_URL: string;
  KEEPER_ALERT_WEBHOOK_URL?: string;
  KEEPER_PUBLIC_URL?: string;
  KEEPER_MAINNET_KEYPAIR?: string;
  KEEPER_ALLOW_FORK: string;
  KEEPER_FORK_GENESIS?: string;
  KEEPER_JUPITER_URL: string;
  JUPITER_API_KEY?: string;
  KEEPER_JITO_URL?: string;
  KEEPER_JITO_TIP_LAMPORTS: number;
};

/** Issues for the key separation and the mainnet modes; `issue(path, message)` reports one. */
export function mainnetEnvIssues(
  env: Fields,
  issue: (path: string, message: string) => void,
) {
  if (!isMainnetCluster(env.KEEPER_CLUSTER)) {
    if (env.KEEPER_MAINNET_KEYPAIR)
      issue(
        "KEEPER_MAINNET_KEYPAIR",
        "the mainnet key is refused on devnet and localnet",
      );
    if (!env.KEEPER_KEYPAIR) issue("KEEPER_KEYPAIR", "is required");
    return;
  }
  if (!env.KEEPER_MAINNET_KEYPAIR)
    issue("KEEPER_MAINNET_KEYPAIR", "is required on mainnet");
  if (env.KEEPER_KEYPAIR)
    issue(
      "KEEPER_KEYPAIR",
      "the devnet key must not be set on mainnet (use KEEPER_MAINNET_KEYPAIR)",
    );
  if (env.KEEPER_KEYPAIR && env.KEEPER_KEYPAIR === env.KEEPER_MAINNET_KEYPAIR)
    issue("KEEPER_MAINNET_KEYPAIR", "must differ from the devnet key");
  if (env.KEEPER_JITO_URL && env.KEEPER_JITO_TIP_LAMPORTS === 0)
    issue("KEEPER_JITO_TIP_LAMPORTS", "a Jito URL needs a tip");
  if (env.KEEPER_CLUSTER === "mainnet-fork") {
    if (env.NODE_ENV === "production")
      issue("KEEPER_CLUSTER", "mainnet-fork is refused in production");
    if (env.KEEPER_ALLOW_FORK !== "true")
      issue("KEEPER_CLUSTER", "mainnet-fork needs KEEPER_ALLOW_FORK=true");
    if (!env.KEEPER_FORK_GENESIS)
      issue("KEEPER_FORK_GENESIS", "is required for mainnet-fork");
    if (!LOOPBACK.test(new URL(env.KEEPER_RPC_URL).origin))
      issue("KEEPER_RPC_URL", "mainnet-fork needs a loopback RPC");
    return;
  }
  if (env.KEEPER_ALLOW_FORK === "true")
    issue("KEEPER_ALLOW_FORK", "is refused on mainnet");
  if (/devnet|testnet/.test(new URL(env.KEEPER_RPC_URL).host))
    issue("KEEPER_RPC_URL", "must be a mainnet RPC");
  for (const key of [
    "KEEPER_RPC_URL",
    "UPSTASH_REDIS_REST_URL",
    "HERMES_URL",
    "KEEPER_JUPITER_URL",
    "KEEPER_JITO_URL",
    "KEEPER_ALERT_WEBHOOK_URL",
    "KEEPER_PUBLIC_URL",
  ] as const) {
    const value = env[key];
    if (value && !value.startsWith("https://"))
      issue(key, "must be https:// on mainnet");
  }
  if (env.NODE_ENV === "production") {
    if (!env.JUPITER_API_KEY)
      issue("JUPITER_API_KEY", "is required on mainnet in production");
    if (!env.PYTH_API_KEY)
      issue("PYTH_API_KEY", "is required on mainnet in production");
  }
}
