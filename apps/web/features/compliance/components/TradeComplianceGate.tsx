import type { ReactNode } from "react";
import type { Signer } from "../../wallet/context";
import { useComplianceStatus } from "../queries";
import { JurisdictionNotice } from "./JurisdictionNotice";
import { TermsGate } from "./TermsGate";

/**
 * Wraps a mainnet "Get quote" control (M9). Order: location (blocked → honest notice, browse and
 * paper stay available) → terms (not accepted → TermsGate) → the children. The server enforces
 * the same gates on every quote; this only shows the state before the user asks.
 */
export function TradeComplianceGate({
  live,
  signer,
  children,
}: {
  /** False for paper practice: no transaction, so no gate. */
  live: boolean;
  signer: Signer | null;
  children: ReactNode;
}) {
  const status = useComplianceStatus(signer?.address ?? null, live);
  if (!live) return <>{children}</>;
  if (status.isPending)
    return (
      <p role="status" className="mt-4 text-small text-muted">
        Checking whether mainnet purchases are available…
      </p>
    );
  if (status.isError)
    return (
      <p role="alert" className="mt-4 text-small text-down">
        Mainnet purchase availability could not be checked.{" "}
        {status.error.message}
      </p>
    );
  if (!status.data.trade)
    return <JurisdictionNotice jurisdiction={status.data.jurisdiction} />;
  if (signer && status.data.terms.accepted === false)
    return <TermsGate signer={signer} terms={status.data.terms} />;
  return <>{children}</>;
}
