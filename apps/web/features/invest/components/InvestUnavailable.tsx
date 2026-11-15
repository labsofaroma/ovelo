import { Info } from "lucide-react";
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
      className="flex gap-3 rounded-tile border border-line bg-raised px-4 py-4 md:px-5"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <span data-testid="cluster-label">
          <ClusterLabel cluster={cluster} />
        </span>
        <p role="status" className="text-small leading-body text-ink">
          {message}
        </p>
        <p className="text-caption text-muted">
          Spot purchases of single stocks and baskets on mainnet are unaffected.
        </p>
      </div>
    </section>
  );
}
