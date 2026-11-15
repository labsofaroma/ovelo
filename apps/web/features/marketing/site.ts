import { z } from "zod";

/**
 * Port of the prototype's lib/site.ts (REWRITE-PLAN §5.2) for v1 code. Same variables and rules;
 * the prototype file stays until M7. Invalid values are ignored, never echoed.
 */
const email = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const https = z.string().regex(/^https:\/\/\S+$/);

export interface SiteContact {
  operatorName: string;
  supportEmail: string | null;
  issuesUrl: string | null;
}

export function siteContact(
  env: Record<string, string | undefined> = process.env,
): SiteContact {
  const supportEmail = email.safeParse(env.OVELO_SUPPORT_EMAIL ?? "");
  const issuesUrl = https.safeParse(env.OVELO_ISSUES_URL ?? "");
  return {
    operatorName:
      env.OVELO_OPERATOR_NAME?.trim() || "the Ovelo project contributors",
    supportEmail: supportEmail.success ? supportEmail.data : null,
    issuesUrl: issuesUrl.success ? issuesUrl.data : null,
  };
}
