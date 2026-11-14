import { betaConfig } from "@/features/beta/config";
import {
  BETA_DEFAULT_DAILY_RAW,
  BETA_DEFAULT_TRADE_RAW,
  capsConfig,
} from "@/features/caps/config";
import { SCHEMA_VARIABLES } from "./env.schema";
import type { Finding } from "./prod-env";

/**
 * `pnpm check:prod-env --profile beta` (Phase A, REWRITE-PLAN §7.3): the production profile plus
 * what `beta.<domain>` needs. Pure; names and statuses only, never a value.
 * - the private-beta gate set to `on` EXPLICITLY (`off` is Phase B);
 * - both caps set (the production profile already requires them); above the beta values warns;
 * - no browser-visible variable v1 does not read: a `NEXT_PUBLIC_*` value ships in the bundle,
 *   and the prototype still reads some (e.g. its embedded-wallet login) that must stay off a
 *   wallet-only v1 deployment;
 * - `AROMA_SITE_URL` on a `beta.` host (a warning: the owner may pick another name).
 * The mainnet genesis is checked read-only by the shared `genesisFindings`.
 */
type Env = Record<string, string | undefined>;

/** Public variables read outside the schema by v1 code (instrumentation-client.ts). */
const PUBLIC_READ_OUTSIDE_SCHEMA = new Set(["NEXT_PUBLIC_SENTRY_ENVIRONMENT"]);
const KNOWN = new Set(SCHEMA_VARIABLES);

export function betaFindings(env: Env): Finding[] {
  const findings: Finding[] = [];
  const add = (name: string, status: Finding["status"], detail: string) =>
    findings.push({ name, status, detail });

  const gate = env.AROMA_BETA_GATE?.trim();
  if (!gate)
    add("AROMA_BETA_GATE", "missing", "set it to on explicitly for the beta");
  else if (gate === "off")
    add("AROMA_BETA_GATE", "forbidden", "off is Phase B; the beta needs on");
  else if (gate === "on" && betaConfig({ ...env, NODE_ENV: "production" }).gate)
    add("AROMA_BETA_GATE", "ok", "on");
  // Any other value is reported invalid by the production profile (the boot schema).

  try {
    const caps = capsConfig({ ...env, NODE_ENV: "production" });
    if (caps.perTrade > BETA_DEFAULT_TRADE_RAW)
      add(
        "AROMA_MAX_TRADE_USDC_RAW",
        "warning",
        "above the Phase A beta value ($50)",
      );
    if (caps.daily > BETA_DEFAULT_DAILY_RAW)
      add(
        "AROMA_MAX_DAILY_USDC_RAW",
        "warning",
        "above the Phase A beta value ($200)",
      );
  } catch {
    // Reported by the production profile (required and validated there).
  }

  findings.push(...unknownPublicFindings(env, "the beta"));

  try {
    const host = new URL(env.AROMA_SITE_URL ?? "").hostname;
    if (!host.startsWith("beta."))
      add("AROMA_SITE_URL", "warning", "not a beta.<domain> host");
  } catch {
    // Missing or invalid: reported by the production profile.
  }
  return findings;
}

/**
 * A `NEXT_PUBLIC_*` value ships in the browser bundle: any one v1 does not read (a leftover
 * prototype login id, a typo) is refused on a deployment (beta and production profiles).
 */
export function unknownPublicFindings(env: Env, deployment: string): Finding[] {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        name.startsWith("NEXT_PUBLIC_") &&
        value?.trim() &&
        !KNOWN.has(name) &&
        !PUBLIC_READ_OUTSIDE_SCHEMA.has(name),
    )
    .map(([name]) => ({
      name,
      status: "forbidden" as const,
      detail: `a browser-visible variable v1 does not read; unset it for ${deployment}`,
    }));
}
