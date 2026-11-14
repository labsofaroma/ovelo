import { loadPolicy } from "@/features/compliance/policy";
import { parseEnv, TURNSTILE_TEST_SECRETS } from "./env.schema";

/**
 * Production profile check (P3, `pnpm check:prod-env`). Pure apart from the injected `fetch`:
 * it validates an environment with the REAL boot schema forced into production mode, then adds
 * the launch rules the boot schema cannot know (what M9 needs present, no placeholder or test
 * value, compliance not opened, mainnet genesis by a read-only `getGenesisHash`). Output is
 * variable NAMES and statuses only; a value is never returned, printed or thrown.
 */

export type Level = "required" | "recommended";
export type Finding = {
  name: string;
  status: "ok" | "missing" | "invalid" | "forbidden" | "warning";
  detail: string;
};

type Env = Record<string, string | undefined>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What the web app needs for M9 (spot and baskets live). Keeper, Hermes, QStash: M10. */
export const WEB_PRODUCTION: readonly {
  name: string;
  level: Level;
  milestone: string;
}[] = [
  { name: "AROMA_V1_ENABLED", level: "required", milestone: "M9" },
  { name: "AROMA_SITE_URL", level: "required", milestone: "M9" },
  { name: "SOLANA_RPC_URL", level: "required", milestone: "M9" },
  { name: "NEXT_PUBLIC_SOLANA_RPC_URL", level: "required", milestone: "M9" },
  { name: "DATABASE_URL", level: "required", milestone: "M9" },
  { name: "UPSTASH_REDIS_REST_URL", level: "required", milestone: "M9" },
  { name: "UPSTASH_REDIS_REST_TOKEN", level: "required", milestone: "M9" },
  { name: "AROMA_TRADE_SECRET", level: "required", milestone: "M9" },
  { name: "JUPITER_API_KEY", level: "required", milestone: "M9" },
  { name: "SENTRY_DSN", level: "required", milestone: "M9" },
  { name: "NEXT_PUBLIC_SENTRY_DSN", level: "required", milestone: "M9" },
  { name: "SENTRY_ENVIRONMENT", level: "recommended", milestone: "M9" },
  { name: "JITO_BLOCK_ENGINE_URL", level: "recommended", milestone: "M9" },
  { name: "AROMA_REVALIDATE_SECRET", level: "recommended", milestone: "M9" },
  { name: "PYTH_API_KEY", level: "recommended", milestone: "M10" },
  {
    name: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    level: "recommended",
    milestone: "M7 faucet",
  },
  {
    name: "TURNSTILE_SECRET_KEY",
    level: "recommended",
    milestone: "M7 faucet",
  },
];

/** Must be unset (or false) in production. */
const FORBIDDEN_TRUE = [
  "AROMA_V1_ALLOW_TEST_SWITCHES",
  "NEXT_PUBLIC_AROMA_E2E_WALLET",
  "NEXT_PUBLIC_AROMA_LOCALNET",
] as const;
const FORBIDDEN_SET = [
  "AROMA_V1_TEST_FORK_GENESIS",
  "AROMA_V1_TEST_JUPITER_URL",
  "AROMA_V1_SIMULATE_UPSTREAM_OUTAGE",
  "AROMA_V1_LOCALNET_RPC_URL",
  "AROMA_V1_LOCALNET_GENESIS",
  "AROMA_V1_LOCALNET_FUNDING_MINT",
  "AROMA_LOCAL_NEON_WS_PROXY",
  "AROMA_SKIP_ENV_CHECK",
] as const;

/** Cloudflare's published Turnstile test SITE keys (secrets are in env.rules). */
const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
]);

const PLACEHOLDER =
  /(\.invalid\b|placeholder|changeme|replace[-_ ]?me|example\.(com|org)|aroma-local-only)/i;
const APP_VARIABLE =
  /^(AROMA_|NEXT_PUBLIC_|SOLANA_|UPSTASH_|DATABASE_URL|JUPITER_|PYTH_|SENTRY_|JITO_|TURNSTILE_|QSTASH_|KEEPER_|CREATOR_|HERMES_)/;
const NON_MAINNET_RPC = /(devnet|testnet|localhost|127\.0\.0\.1|\[::1\])/i;
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const present = (env: Env, name: string) => Boolean(env[name]?.trim());

export function staticFindings(env: Env): Finding[] {
  const findings: Finding[] = [];
  const add = (name: string, status: Finding["status"], detail: string) =>
    findings.push({ name, status, detail });

  // 1. The real boot schema, in production mode (VERCEL_ENV=production rules apply).
  const parsed = parseEnv({
    ...env,
    NODE_ENV: "production",
    VERCEL_ENV: "production",
  });
  const invalid = new Set<string>();
  if (!parsed.ok)
    for (const issue of parsed.error.issues) {
      invalid.add(issue.variable);
      add(issue.variable, "invalid", issue.problem);
    }

  // 2. Presence for M9.
  for (const item of WEB_PRODUCTION) {
    if (invalid.has(item.name)) continue;
    if (present(env, item.name))
      add(item.name, "ok", `${item.level}, ${item.milestone}`);
    else
      add(
        item.name,
        item.level === "required" ? "missing" : "warning",
        `${item.level} for ${item.milestone}; not set`,
      );
  }
  if (env.AROMA_V1_ENABLED?.trim() && env.AROMA_V1_ENABLED.trim() !== "true")
    add("AROMA_V1_ENABLED", "invalid", "must be true in production");

  // 3. Test and local switches.
  for (const name of FORBIDDEN_TRUE)
    if (env[name]?.trim() === "true")
      add(name, "forbidden", "a test switch; must be unset in production");
  for (const name of FORBIDDEN_SET)
    if (present(env, name))
      add(name, "forbidden", "test or local only; must be unset in production");
  if (env.AROMA_V1_INVEST_CLUSTER?.trim() === "localnet")
    add("AROMA_V1_INVEST_CLUSTER", "forbidden", "localnet in production");
  if (
    env.TURNSTILE_SECRET_KEY &&
    TURNSTILE_TEST_SECRETS.has(env.TURNSTILE_SECRET_KEY.trim())
  )
    add("TURNSTILE_SECRET_KEY", "forbidden", "a Cloudflare test secret");
  if (
    env.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
    TURNSTILE_TEST_SITE_KEYS.has(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY.trim())
  )
    add(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "forbidden",
      "a Cloudflare test site key",
    );

  // 4. Placeholder values (e.g. copied from .env.example) anywhere.
  for (const [name, value] of Object.entries(env))
    if (APP_VARIABLE.test(name) && value && PLACEHOLDER.test(value))
      add(name, "forbidden", "looks like a placeholder or test value");

  // 5. Mainnet URLs must not name another cluster or a local node.
  for (const name of [
    "SOLANA_RPC_URL",
    "NEXT_PUBLIC_SOLANA_RPC_URL",
    "NEXT_PUBLIC_SOLANA_WS_URL",
  ])
    if (env[name] && NON_MAINNET_RPC.test(env[name]!))
      add(name, "forbidden", "names a devnet, testnet or local endpoint");
  for (const name of ["SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"])
    if (env[name]?.includes("api.mainnet-beta.solana.com"))
      add(
        name,
        "warning",
        "the public endpoint is rate-limited; use a paid RPC (P3)",
      );

  // 6. Compliance gate (M9): policy valid, fail closed, US restricted.
  try {
    const policy = loadPolicy(env);
    if (policy.missingCountry !== "block")
      add(
        "AROMA_COMPLIANCE_MISSING_COUNTRY",
        "forbidden",
        "must be block in production (fail closed)",
      );
    if (!policy.restrictedCountries.includes("US"))
      add(
        "AROMA_COMPLIANCE_RESTRICTED_COUNTRIES",
        "forbidden",
        "must include US",
      );
  } catch (error) {
    const names = (error as { variables?: string[] }).variables ?? [
      "AROMA_COMPLIANCE",
    ];
    for (const name of names) add(name, "invalid", "invalid compliance policy");
  }

  // 7. Rotation hygiene.
  if (present(env, "AROMA_TRADE_SECRET_PREVIOUS"))
    add(
      "AROMA_TRADE_SECRET_PREVIOUS",
      "warning",
      "a rotation is in progress; remove it after one quote lifetime",
    );
  return findings;
}

/** Read-only `getGenesisHash` on each configured mainnet RPC. Never another method. */
export async function genesisFindings(
  env: Env,
  fetch: Fetch,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const name of ["SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) {
    const url = env[name]?.trim();
    if (!url || !url.startsWith("https://")) continue;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getGenesisHash",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as { result?: unknown };
      findings.push(
        body.result === MAINNET_GENESIS
          ? { name, status: "ok", detail: "genesis is mainnet-beta" }
          : { name, status: "invalid", detail: "genesis is NOT mainnet-beta" },
      );
    } catch {
      findings.push({
        name,
        status: "invalid",
        detail: "genesis check failed (unreachable or not JSON-RPC)",
      });
    }
  }
  return findings;
}

export function failed(findings: readonly Finding[]): boolean {
  return findings.some(
    (f) =>
      f.status === "missing" ||
      f.status === "invalid" ||
      f.status === "forbidden",
  );
}

/** One line per finding: status and name. Never a value. */
export function report(findings: readonly Finding[]): string {
  const order: Finding["status"][] = [
    "forbidden",
    "invalid",
    "missing",
    "warning",
    "ok",
  ];
  return [...findings]
    .sort(
      (a, b) =>
        order.indexOf(a.status) - order.indexOf(b.status) ||
        a.name.localeCompare(b.name),
    )
    .map((f) => `${f.status.toUpperCase().padEnd(9)} ${f.name}: ${f.detail}`)
    .join("\n");
}
