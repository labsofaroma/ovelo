"use client";

import { useQuery } from "@tanstack/react-query";
import { complianceApi } from "../../compliance/api";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";

/** /settings wallet section: the connected wallet, its terms status (read-only), disconnect. */
export function SettingsWallet() {
  return (
    <QueryProvider>
      <WalletBoundary>
        <WalletSection />
      </WalletBoundary>
    </QueryProvider>
  );
}

function WalletSection() {
  const wallet = useWallet();
  const address = wallet.signer?.address ?? null;
  return (
    <div className="flex flex-col items-start gap-3">
      {address ? (
        <p className="text-small">
          Connected wallet:{" "}
          <span className="font-mono break-all">{address}</span>
        </p>
      ) : (
        <p className="text-small text-muted">
          No wallet connected. Ovelo never holds your keys or funds; connecting
          only lets this page read your terms status.
        </p>
      )}
      {/* Connect, or (when connected) disconnect: the same control as everywhere else. */}
      <ConnectButton />
      {wallet.error ? (
        <p role="alert" className="text-small text-down">
          {wallet.error}
        </p>
      ) : null}
      {address ? <TermsStatus address={address} /> : null}
    </div>
  );
}

function TermsStatus({ address }: { address: string }) {
  const status = useQuery({
    queryKey: ["compliance-status", address],
    queryFn: () => complianceApi.status(address),
    staleTime: 30_000,
    // A read-only status: one retry, then say it is unavailable.
    retry: 1,
  });
  if (status.isPending)
    return <p className="text-small text-muted">Checking the terms status…</p>;
  if (status.isError)
    return (
      <p role="alert" className="text-small text-muted">
        The terms status is unavailable right now ({status.error.message}). It
        does not mean the terms were not accepted.
      </p>
    );
  const { terms } = status.data;
  return (
    <dl className="grid gap-1 text-small" data-testid="terms-status">
      <div className="flex flex-wrap gap-2">
        <dt className="text-muted">Terms of use, version</dt>
        <dd className="font-mono">{terms.version}</dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <dt className="text-muted">Accepted by this wallet</dt>
        <dd>
          {terms.accepted === true
            ? "Yes, the current version"
            : terms.accepted === false
              ? "Not yet: you will be asked to sign them before your first quote"
              : "Unknown"}
        </dd>
      </div>
    </dl>
  );
}
