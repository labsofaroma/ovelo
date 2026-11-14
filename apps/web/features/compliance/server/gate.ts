import "server-only";
import { AppError } from "@/server/errors";
import {
  jurisdictionOf,
  restrictedMessage,
  surfaceAllowed,
  type Jurisdiction,
  type Surface,
} from "../jurisdiction";
import type { CompliancePolicy } from "../policy";
import { assertTermsAccepted, type TermsDeps } from "./terms";

/**
 * Route-level compliance checks (M9). Middleware already geo-blocks every gated POST at the
 * edge; the routes check again (defense in depth: a matcher change cannot open trading) and
 * add the terms check, which needs the database.
 */

export function requestJurisdiction(
  request: Request,
  policy: CompliancePolicy,
): Jurisdiction {
  return jurisdictionOf(request.headers, process.env, policy);
}

export function assertJurisdiction(
  request: Request,
  surface: Exclude<Surface, "browse">,
  policy: CompliancePolicy,
): Jurisdiction {
  const jurisdiction = requestJurisdiction(request, policy);
  if (!surfaceAllowed(jurisdiction, surface, policy))
    throw new AppError("JURISDICTION_RESTRICTED", {
      publicMessage: restrictedMessage(jurisdiction),
      detail: `geo ${jurisdiction.status}`,
    });
  return jurisdiction;
}

/** Every mainnet quote (ticket and Action): allowed location, then current terms accepted. */
export async function assertTradeCompliance(
  request: Request,
  wallet: string,
  deps: TermsDeps,
  options: { termsMessage?: string } = {},
): Promise<void> {
  assertJurisdiction(request, "trade", deps.policy());
  await assertTermsAccepted(deps, wallet, options.termsMessage);
}
