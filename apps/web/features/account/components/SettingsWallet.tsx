"use client";

import { useQuery } from "@tanstack/react-query";
import { complianceApi } from "../../compliance/api";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { SettingsRow } from "./SettingsRow";

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
    <div className="flex flex-col">
      <SettingsRow
        title={address ? "Connected wallet" : "Solana wallet"}
        body={
          address ? (
            <span className="font-mono text-caption break-all text-ink">
              {address}
            </span>
          ) : (
            "No wallet connected. Ovelo never holds your keys or funds; connecting only lets this page read your terms status."
          )
        }
      >
        {/* Connect, or (when connected) disconnect: the same control as everywhere else. */}
        <ConnectButton />
      </SettingsRow>
      {wallet.error ? (
        <p role="alert" className="pb-5 text-small text-down">
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
    return (
      <SettingsRow title="Terms of use" body="Checking the terms status…" />
    );
  if (status.isError)
    return (
      <SettingsRow
        title="Terms of use"
        body={
          <span role="alert">
            The terms status is unavailable right now ({status.error.message}).
            It does not mean the terms were not accepted.
          </span>
        }
      />
    );
  const { terms } = status.data;
  return (
    <div className="border-t border-line pt-5">
      <dl
        className="grid gap-3 text-small sm:grid-cols-2"
        data-testid="terms-status"
      >
        <div className="flex flex-col gap-1 rounded-tile border border-line bg-raised p-4">
          <dt className="text-caption text-muted">Terms of use, version</dt>
          <dd className="font-mono text-ink">{terms.version}</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-tile border border-line bg-raised p-4">
          <dt className="text-caption text-muted">Accepted by this wallet</dt>
          <dd className="text-ink">
            {terms.accepted === true
              ? "Yes, the current version"
              : terms.accepted === false
                ? "Not yet: you will be asked to sign them before your first quote"
                : "Unknown"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
