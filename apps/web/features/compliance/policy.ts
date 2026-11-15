import { z } from "zod";
import { CURRENT_TERMS_VERSION, TERMS_VERSIONS } from "./terms";

/**
 * Jurisdiction policy (M9 compliance gate, REWRITE-PLAN §7 M9 and §7.1 P1). CONFIGURATION, not
 * code: the defaults below are overridden per deployment by the OVELO_COMPLIANCE_* variables
 * (validated in server/env.compliance.ts at boot and again here). Pure: no `server-only`, no I/O,
 * so middleware, routes and the prod-env check all read the same policy.
 *
 * Counsel decided the level of enforcement (per P1): IP geo-blocking at every trading entry
 * point, terms acceptance before the first trade, and a risk disclosure on every trade review.
 * IP geolocation is NOT identity verification and VPNs exist (docs/launch/COMPLIANCE.md).
 */

/** ISO 3166-1 alpha-2, upper case (the format of Vercel's `x-vercel-ip-country`). */
export const countryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, "must be an ISO 3166-1 alpha-2 code");

/**
 * Default restricted list. US is decided (xStocks are not offered to US persons). The rest is a
 * PLACEHOLDER, marked "confirm with counsel": comprehensively sanctioned jurisdictions that a
 * final list will almost certainly cover. Counsel supplies the final list (COMPLIANCE.md §4).
 */
export const DEFAULT_RESTRICTED_COUNTRIES = {
  decided: ["US"],
  /** confirm with counsel */
  placeholder: ["CU", "IR", "KP", "SY", "RU", "BY"],
} as const;

const surfaceRule = z.enum(["allow", "block"]);

export const policySchema = z.strictObject({
  restrictedCountries: z.array(countryCode).min(1),
  /** No trusted country header (unknown location): `block` fails closed (the default). */
  missingCountry: surfaceRule,
  surfaces: z.strictObject({
    /** Read-only pages for a restricted visitor: `allow` = browse-only, `block` = notice page. */
    browse: surfaceRule,
    /** Mainnet spot, basket, creator basket and Action purchases: ALWAYS blocked (not configurable). */
    trade: z.literal("block"),
    /** Devnet recurring test plans and the devnet faucet (test tokens, no value). */
    devnet: surfaceRule,
  }),
  termsVersion: z.enum(
    TERMS_VERSIONS.map((t) => t.version) as [string, ...string[]],
  ),
});
export type CompliancePolicy = z.infer<typeof policySchema>;

export const DEFAULT_POLICY: CompliancePolicy = {
  restrictedCountries: [
    ...DEFAULT_RESTRICTED_COUNTRIES.decided,
    ...DEFAULT_RESTRICTED_COUNTRIES.placeholder,
  ],
  missingCountry: "block",
  surfaces: { browse: "allow", trade: "block", devnet: "block" },
  termsVersion: CURRENT_TERMS_VERSION,
};

/** The variables that override the defaults. Values are never logged; names are. */
export const POLICY_ENV = [
  "OVELO_COMPLIANCE_RESTRICTED_COUNTRIES",
  "OVELO_COMPLIANCE_MISSING_COUNTRY",
  "OVELO_COMPLIANCE_BROWSE",
  "OVELO_COMPLIANCE_DEVNET",
  "OVELO_TERMS_VERSION",
] as const;

export class PolicyError extends Error {
  readonly variables: readonly string[];
  constructor(variables: readonly string[]) {
    super(`Invalid compliance policy: ${variables.join(", ")}`);
    this.name = "PolicyError";
    this.variables = variables;
  }
}

type Source = Record<string, string | undefined>;
const value = (env: Source, key: string) => env[key]?.trim() || undefined;

/** Defaults merged with the env overrides, then zod-validated. Throws PolicyError (names only). */
export function loadPolicy(env: Source): CompliancePolicy {
  const countries = value(env, "OVELO_COMPLIANCE_RESTRICTED_COUNTRIES");
  const candidate = {
    restrictedCountries: countries
      ? countries.split(",").map((c) => c.trim().toUpperCase())
      : DEFAULT_POLICY.restrictedCountries,
    missingCountry:
      value(env, "OVELO_COMPLIANCE_MISSING_COUNTRY") ??
      DEFAULT_POLICY.missingCountry,
    surfaces: {
      browse:
        value(env, "OVELO_COMPLIANCE_BROWSE") ?? DEFAULT_POLICY.surfaces.browse,
      trade: "block",
      devnet:
        value(env, "OVELO_COMPLIANCE_DEVNET") ?? DEFAULT_POLICY.surfaces.devnet,
    },
    termsVersion:
      value(env, "OVELO_TERMS_VERSION") ?? DEFAULT_POLICY.termsVersion,
  };
  const parsed = policySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const ENV_OF: Record<string, string> = {
    restrictedCountries: "OVELO_COMPLIANCE_RESTRICTED_COUNTRIES",
    missingCountry: "OVELO_COMPLIANCE_MISSING_COUNTRY",
    browse: "OVELO_COMPLIANCE_BROWSE",
    devnet: "OVELO_COMPLIANCE_DEVNET",
    termsVersion: "OVELO_TERMS_VERSION",
  };
  const names = parsed.error.issues.map((issue) => {
    const leaf =
      issue.path[0] === "surfaces"
        ? String(issue.path[1])
        : String(issue.path[0]);
    return ENV_OF[leaf] ?? "OVELO_COMPLIANCE";
  });
  throw new PolicyError([...new Set(names)]);
}
