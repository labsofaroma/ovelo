import { NOTIFY_CHANNEL_VARIABLES } from "./env.notify";
import type { Finding } from "./prod-env";

/**
 * M11 launch-feature checks, part of both profiles (beta and production). Pure; names and
 * statuses only. Half-set channels, a missing worker secret with a channel, the E2E sink and a
 * non-zero platform fee are already refused by the boot schema (reported as invalid there).
 */
type Env = Record<string, string | undefined>;
const set = (env: Env, name: string) => Boolean(env[name]?.trim());

export function m11Findings(env: Env): Finding[] {
  const findings: Finding[] = [];
  const add = (name: string, status: Finding["status"], detail: string) =>
    findings.push({ name, status, detail });

  for (const [channel, variables] of Object.entries(NOTIFY_CHANNEL_VARIABLES))
    if (variables.every((v) => set(env, v)))
      add(variables[0], "ok", `notification channel ${channel} on`);
    else if (variables.every((v) => !set(env, v)))
      add(
        variables[0],
        "warning",
        `notification channel ${channel} off (optional)`,
      );
  if (env.AROMA_NOTIFICATIONS?.trim() === "off")
    add("AROMA_NOTIFICATIONS", "warning", "notifications are paused");
  // The periodic worker also writes the fee-share ledger, so it is wanted even with no channel.
  if (!set(env, "AROMA_NOTIFY_WORKER_SECRET"))
    add(
      "AROMA_NOTIFY_WORKER_SECRET",
      "warning",
      "recommended for M11: the periodic worker (notifications, fee-share ledger) cannot run",
    );
  else add("AROMA_NOTIFY_WORKER_SECRET", "ok", "periodic worker can run");

  // Analytics run only after consent, and only when the domain is the site's own host.
  const domain = env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN?.trim();
  if (domain) {
    let host = "";
    try {
      host = new URL(env.AROMA_SITE_URL ?? "").hostname;
    } catch {
      // Reported by the shared profile.
    }
    if (host && host !== domain)
      add(
        "NEXT_PUBLIC_PLAUSIBLE_DOMAIN",
        "warning",
        "differs from the AROMA_SITE_URL host, so no analytics event is ever sent",
      );
    else
      add("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", "ok", "analytics after consent only");
  }

  if (
    set(env, "AROMA_PLATFORM_FEE_BPS") &&
    env.AROMA_PLATFORM_FEE_BPS?.trim() === "0"
  )
    add("AROMA_PLATFORM_FEE_BPS", "ok", "0 (no platform fee)");
  if (set(env, "AROMA_CREATOR_FEE_SHARE_BPS"))
    add(
      "AROMA_CREATOR_FEE_SHARE_BPS",
      "ok",
      "recorded in the ledger only (no payout)",
    );
  return findings;
}
