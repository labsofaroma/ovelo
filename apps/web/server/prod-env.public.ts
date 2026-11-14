import { unknownPublicFindings } from "./prod-env.beta";
import type { Finding } from "./prod-env";

/**
 * `pnpm check:prod-env --profile production` (M9 Phase B, the public spot launch; the default
 * profile): the shared production checks (server/prod-env.ts: the boot schema forced to
 * production, every P3 spot variable, the caps required, the fallback RPC recommended, no test or
 * placeholder values, each mainnet RPC's genesis read-only) plus what the production domain needs:
 * - the private-beta gate may be `off` (the public launch); `on` or unset (= on in production)
 *   warns until runbook step 9 switches it off;
 * - `AROMA_SITE_URL` is the production domain: a `beta.` host fails, a `*.vercel.app` host warns;
 * - no browser-visible variable v1 does not read.
 * Pure; names and statuses only, never a value.
 */
type Env = Record<string, string | undefined>;

export function publicLaunchFindings(env: Env): Finding[] {
  const findings: Finding[] = [];
  const add = (name: string, status: Finding["status"], detail: string) =>
    findings.push({ name, status, detail });

  const gate = env.AROMA_BETA_GATE?.trim();
  if (gate === "off") add("AROMA_BETA_GATE", "ok", "off (public launch)");
  else if (gate === "on")
    add(
      "AROMA_BETA_GATE",
      "warning",
      "on: invited wallets only; set off at CUTOVER-RUNBOOK step 9",
    );
  else if (!gate)
    add(
      "AROMA_BETA_GATE",
      "warning",
      "unset means on in production; set off at CUTOVER-RUNBOOK step 9",
    );

  try {
    const host = new URL(env.AROMA_SITE_URL ?? "").hostname;
    if (host.startsWith("beta."))
      add(
        "AROMA_SITE_URL",
        "forbidden",
        "a beta.<domain> host: the production profile needs the production domain",
      );
    else if (host.endsWith(".vercel.app"))
      add(
        "AROMA_SITE_URL",
        "warning",
        "a vercel.app host: point the production domain at the project (owner, DNS)",
      );
  } catch {
    // Missing or invalid: reported by the shared production checks.
  }

  findings.push(...unknownPublicFindings(env, "production"));
  return findings;
}
