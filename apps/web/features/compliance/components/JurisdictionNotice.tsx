import type { ComplianceStatus } from "../schema";

/** The honest blocked state for a restricted or unknown location (M9, C2). Browse stays available. */
export function JurisdictionNotice({
  jurisdiction,
}: {
  jurisdiction: ComplianceStatus["jurisdiction"];
}) {
  return (
    <div
      role="status"
      data-state="jurisdiction-restricted"
      className="mt-4 rounded-control bg-warning-soft p-3 text-small text-ink"
    >
      <p className="font-semibold">Mainnet purchases are not available here</p>
      <p className="mt-1">
        {jurisdiction === "unknown"
          ? "Your location could not be confirmed, so mainnet purchases are turned off. Nothing will be quoted or sent."
          : "Mainnet purchases are not offered in your location. You can still browse market information and use paper practice."}
      </p>
      <p className="mt-1 text-caption text-muted">
        This check uses your network location only. It is not identity
        verification.
      </p>
    </div>
  );
}
