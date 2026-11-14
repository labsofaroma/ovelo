import { trustsProxy } from "@/server/request-guard";
import { countryCode, type CompliancePolicy } from "./policy";

/**
 * Geo-blocking decisions (M9 compliance gate, C2). Pure, so middleware, the Action GET and the
 * status route all decide the same way and it is unit-tested directly.
 *
 * The country comes ONLY from the platform header (Vercel's `x-vercel-ip-country`), and only
 * behind the trusted proxy (`trustsProxy`, the same rule as request-guard's client IP): anyone
 * can send that header to a server that is reached directly. Untrusted or absent → unknown, and
 * an unknown country fails closed unless the policy says `missingCountry: "allow"`.
 */

type Env = Record<string, string | undefined>;

export const COUNTRY_HEADER = "x-vercel-ip-country";

export type Surface = "trade" | "devnet" | "browse";

export type Jurisdiction =
  | { status: "allowed"; country: string }
  | { status: "restricted"; country: string }
  | { status: "unknown"; country: null; reason: "untrusted-proxy" | "missing" };

export function jurisdictionOf(
  headers: Headers,
  env: Env,
  policy: CompliancePolicy,
): Jurisdiction {
  if (!trustsProxy(env))
    return { status: "unknown", country: null, reason: "untrusted-proxy" };
  const raw = headers.get(COUNTRY_HEADER)?.trim().toUpperCase() ?? "";
  const parsed = countryCode.safeParse(raw);
  if (!parsed.success)
    return { status: "unknown", country: null, reason: "missing" };
  return policy.restrictedCountries.includes(parsed.data)
    ? { status: "restricted", country: parsed.data }
    : { status: "allowed", country: parsed.data };
}

/** Whether a visitor in `jurisdiction` may use `surface` under `policy`. */
export function surfaceAllowed(
  jurisdiction: Jurisdiction,
  surface: Surface,
  policy: CompliancePolicy,
): boolean {
  if (jurisdiction.status === "allowed") return true;
  if (surface === "browse")
    // Browsing never fails closed on a missing header (read-only pages, nothing is bought).
    return (
      jurisdiction.status === "unknown" || policy.surfaces.browse === "allow"
    );
  if (jurisdiction.status === "unknown")
    return policy.missingCountry === "allow";
  return policy.surfaces[surface] === "allow";
}

/**
 * Trading entry points gated at the edge (middleware). Every POST that quotes, builds, signs for
 * or sends a mainnet purchase is `trade`; the devnet plan and faucet POSTs are `devnet`.
 * Creator basket buys go through /api/v1/trade/quote and the Action POST, so they are covered.
 */
const GATED: readonly {
  pattern: RegExp;
  surface: Exclude<Surface, "browse">;
}[] = [
  { pattern: /^\/api\/v1\/trade\/(quote|submit)$/, surface: "trade" },
  // The Action POST that builds a transaction. Its `/confirm` callback only records a receipt
  // for a transaction already sent, so it stays open (a receipt is never lost to the gate).
  { pattern: /^\/api\/v1\/actions\/baskets\/[^/]+$/, surface: "trade" },
  // Devnet: creating a plan and claiming test tokens. Closing a plan (prepare-close, and the
  // submit that sends it) is never blocked: a user can always exit.
  { pattern: /^\/api\/v1\/plans\/prepare-create$/, surface: "devnet" },
  { pattern: /^\/api\/v1\/faucet$/, surface: "devnet" },
];

export function gatedSurface(
  pathname: string,
  method: string,
): Exclude<Surface, "browse"> | null {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return null;
  return GATED.find((g) => g.pattern.test(pathname))?.surface ?? null;
}

/** The fixed public message for a blocked request (never the country itself). */
export function restrictedMessage(jurisdiction: Jurisdiction): string {
  return jurisdiction.status === "unknown"
    ? "Trading is unavailable because your location could not be confirmed. Nothing was quoted or sent."
    : "Trading is not available in your location. You can still browse market information. Nothing was quoted or sent.";
}
