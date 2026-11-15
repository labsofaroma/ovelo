import { ClusterLabel } from "../../wallet/ClusterLabel";

export const NOT_DEPLOYED_MESSAGE =
  "Recurring investing is not available on devnet yet: Ovelo Guard v1 has not been deployed there.";

/** The honest unavailable state: nothing interactive, nothing faked. */
export function InvestUnavailable({
  cluster,
  message = NOT_DEPLOYED_MESSAGE,
}: {
  cluster: "devnet" | "localnet";
  message?: string;
}) {
  return (
    <section
      data-testid="invest-unavailable"
      className="flex flex-col items-start gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <span data-testid="cluster-label">
        <ClusterLabel cluster={cluster} />
      </span>
      <p role="status" className="text-small">
        {message}
      </p>
      <p className="text-caption text-muted">
        Spot purchases of single stocks and baskets on mainnet are unaffected.
      </p>
    </section>
  );
}
