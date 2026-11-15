import { Badge, Button } from "@ovelo/ui";
import Link from "next/link";
import { routes } from "../../shared/routes";
import { textLink } from "../../shared/styles";
import type { Signer } from "../../wallet/context";
import { useAcceptTerms } from "../queries";
import type { ComplianceStatus } from "../schema";

/**
 * Terms acceptance before the first trade (M9, C3). The wallet signs a message naming the terms
 * version and the SHA-256 of their text; nothing moves funds. Shown again after a version bump.
 */
export function TermsGate({
  signer,
  terms,
}: {
  signer: Signer;
  terms: ComplianceStatus["terms"];
}) {
  const accept = useAcceptTerms(signer);
  return (
    <div
      role="region"
      aria-label="Accept the terms"
      data-terms-version={terms.version}
      className="mt-4 rounded-tile border border-line bg-raised p-4 text-small"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">
          Accept the terms before your first purchase
        </p>
        {terms.final ? null : (
          <Badge tone="neutral">Placeholder terms: pending counsel</Badge>
        )}
      </div>
      <p className="mt-1.5 leading-body text-muted">
        Read the{" "}
        <Link className={textLink} href={routes.terms} target="_blank">
          terms
        </Link>{" "}
        (version {terms.version}). Your wallet signs a message with this version
        and a fingerprint of the text. The signature does not move funds.
      </p>
      {signer.signMessage ? (
        <Button
          variant="solid"
          className="mt-4"
          onClick={() => accept.mutate()}
          loading={accept.isPending}
        >
          Sign to accept the terms
        </Button>
      ) : (
        <p className="mt-2 text-muted">
          This wallet cannot sign messages, so it cannot accept the terms.
          Connect another wallet to buy on mainnet.
        </p>
      )}
      {accept.error ? (
        <p role="alert" className="mt-2 text-down">
          {accept.error.message}
        </p>
      ) : null}
    </div>
  );
}
