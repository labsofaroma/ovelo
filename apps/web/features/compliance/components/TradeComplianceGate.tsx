import type { ReactNode } from "react";
import { BetaGate } from "../../beta/components/BetaGate";
import { useBetaStatus } from "../../beta/queries";
import type { Signer } from "../../wallet/context";
import { useComplianceStatus } from "../queries";
import { JurisdictionNotice } from "./JurisdictionNotice";
import { TermsGate } from "./TermsGate";

/**
 * Wraps a mainnet "Get quote" control (M9, Phase A). Order, the same as the server's
 * (features/beta/server/gate.ts): location (blocked → honest notice, browse and paper stay
 * available) → private-beta access (no access → BetaGate) → terms (not accepted → TermsGate) →
 * the children. The server enforces the same gates on every quote; this only shows the state
 * before the user asks.
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
  const beta = useBetaStatus(signer?.address ?? null, live);
  if (!live) return <>{children}</>;
  if (status.isPending || beta.isPending)
    return (
      <p role="status" className="mt-4 text-small text-muted">
        Checking whether mainnet purchases are available…
      </p>
    );
  if (status.isError || beta.isError)
    return (
      <p role="alert" className="mt-4 text-small text-down">
        Mainnet purchase availability could not be checked.{" "}
        {(status.error ?? beta.error)?.message}
      </p>
    );
  if (!status.data.trade)
    return <JurisdictionNotice jurisdiction={status.data.jurisdiction} />;
  if (signer && beta.data.access === false) return <BetaGate signer={signer} />;
  if (signer && status.data.terms.accepted === false)
    return <TermsGate signer={signer} terms={status.data.terms} />;
  return <>{children}</>;
}
