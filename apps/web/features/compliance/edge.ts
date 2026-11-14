import {
  gatedSurface,
  jurisdictionOf,
  restrictedMessage,
  surfaceAllowed,
} from "./jurisdiction";
import { loadPolicy, type CompliancePolicy } from "./policy";

/**
 * The middleware side of the geo gate (M9, C2). Pure: middleware.ts calls it once per request
 * and turns a refusal into a response. An invalid policy fails CLOSED on every gated path.
 */

type Env = Record<string, string | undefined>;

export type EdgeRefusal = {
  status: 451;
  body: { code: "JURISDICTION_RESTRICTED"; message: string };
};

function policyOrNull(env: Env): CompliancePolicy | null {
  try {
    return loadPolicy(env);
  } catch {
    return null;
  }
}

export function edgeRefusal(
  pathname: string,
  method: string,
  headers: Headers,
  env: Env,
): EdgeRefusal | null {
  const surface = gatedSurface(pathname, method);
  if (!surface) return null;
  const policy = policyOrNull(env);
  if (!policy)
    return {
      status: 451,
      body: {
        code: "JURISDICTION_RESTRICTED",
        message:
          "Trading is unavailable while the compliance policy is misconfigured. Nothing was quoted or sent.",
      },
    };
  const jurisdiction = jurisdictionOf(headers, env, policy);
  if (surfaceAllowed(jurisdiction, surface, policy)) return null;
  return {
    status: 451,
    body: {
      code: "JURISDICTION_RESTRICTED",
      message: restrictedMessage(jurisdiction),
    },
  };
}

/** Pages render the browse-blocked notice instead when browse is `block` (APIs and files never). */
export const RESTRICTED_PAGE = "/restricted";

export function browseBlocked(
  pathname: string,
  headers: Headers,
  env: Env,
): boolean {
  const page =
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    pathname !== "/actions.json" &&
    !/\.[a-z0-9]+$/i.test(pathname);
  if (!page || pathname === RESTRICTED_PAGE) return false;
  // Legal pages stay readable for everyone.
  if (/^\/(terms|privacy)$/.test(pathname)) return false;
  const policy = policyOrNull(env);
  if (!policy || policy.surfaces.browse === "allow") return false;
  return !surfaceAllowed(
    jurisdictionOf(headers, env, policy),
    "browse",
    policy,
  );
}
