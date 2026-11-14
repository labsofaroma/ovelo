import { z } from "zod";

/**
 * M9 compliance gate variables (see features/compliance/policy.ts for their meaning and
 * defaults). Format-checked at boot with the rest of the environment; `loadPolicy` re-validates
 * the merged policy (including the terms version against the registry). All optional: unset
 * means the policy default (US + placeholder list, fail closed, browse-only, devnet blocked).
 */
const rule = z.enum(["allow", "block"]);

export const complianceShape = {
  /** Comma-separated ISO 3166-1 alpha-2 codes. Replaces the default list entirely. */
  AROMA_COMPLIANCE_RESTRICTED_COUNTRIES: z
    .string()
    .regex(
      /^[A-Za-z]{2}(\s*,\s*[A-Za-z]{2})*$/,
      "must be comma-separated ISO 3166-1 alpha-2 codes",
    )
    .optional(),
  /** No trusted country header: `block` (default, fail closed) or `allow`. */
  AROMA_COMPLIANCE_MISSING_COUNTRY: rule.optional(),
  /** Restricted visitors on read-only pages: `allow` (default, browse-only) or `block`. */
  AROMA_COMPLIANCE_BROWSE: rule.optional(),
  /** Restricted visitors on devnet plan creation and the faucet: `block` (default) or `allow`. */
  AROMA_COMPLIANCE_DEVNET: rule.optional(),
  /** The terms version wallets must accept (one of features/compliance/terms.ts). */
  AROMA_TERMS_VERSION: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,63}$/, "must be a terms version id")
    .optional(),
};
