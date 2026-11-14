"use client";

import { DataNotice } from "../../shared/components/DataNotice";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { ClusterLabel } from "../../wallet/ClusterLabel";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { usePlans } from "../queries";
import { formatChainTime } from "../server/format";
import { ClosePlanDialog } from "./ClosePlanDialog";
import { FaucetPanel } from "./FaucetPanel";
import { PlanCard } from "./PlanCard";
import { PlanWizard } from "./PlanWizard";
import type { InvestPageData } from "./types";

/** Client entry for /v1/invest: one devnet (or localnet) wallet boundary, never mainnet. */
export function InvestIsland({ data }: { data: InvestPageData }) {
  return (
    <QueryProvider>
      <WalletBoundary cluster={data.wallet}>
        <InvestBody data={data} />
      </WalletBoundary>
    </QueryProvider>
  );
}

function InvestBody({ data }: { data: InvestPageData }) {
  const wallet = useWallet();
  const owner = wallet.signer?.address ?? null;
  const plans = usePlans(owner);
  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg py-2">
        <span data-testid="cluster-label">
          <ClusterLabel cluster={data.cluster} />
        </span>
        <ConnectButton />
      </div>
      {wallet.error ? (
        <p
          role="alert"
          data-testid="wallet-error"
          className="text-small text-down"
        >
          {wallet.error}
        </p>
      ) : null}
      {!owner ? (
        <p className="text-small text-muted">
          Connect a Solana {data.cluster} wallet to claim test tokens, create a
          plan and see its installments.
        </p>
      ) : (
        <>
          <FaucetPanel
            siteKey={data.turnstileSiteKey}
            nonce={data.nonce}
            cluster={data.cluster}
            explorerRpcUrl={data.explorerRpcUrl}
            fundingSymbol={data.fundingSymbol}
            fundingDecimals={data.fundingDecimals}
            amountRaw={data.faucetAmountRaw}
          />
          <section aria-labelledby="new-plan" className="flex flex-col gap-3">
            <h2 id="new-plan" className="text-section font-semibold">
              New plan
            </h2>
            <PlanWizard data={data} />
          </section>
          <section aria-labelledby="your-plans" className="flex flex-col gap-3">
            <h2 id="your-plans" className="text-section font-semibold">
              Your plans
            </h2>
            {plans.isPending ? (
              <p role="status" className="text-small text-muted">
                Reading your plans from Solana {data.cluster}…
              </p>
            ) : plans.isError ? (
              <DataNotice
                tone="unavailable"
                title="Your plans are unavailable right now"
              >
                <p>{plans.error.message}</p>
              </DataNotice>
            ) : plans.data.plans.length === 0 ? (
              <p className="text-small text-muted">No plans yet.</p>
            ) : (
              <>
                <p className="text-caption text-muted">
                  Source: {plans.data.source}. As of{" "}
                  {formatChainTime(BigInt(plans.data.asOf))} (chain time).
                </p>
                {plans.data.plans.map((plan) => (
                  <PlanCard
                    key={plan.pda}
                    plan={plan}
                    cluster={data.cluster}
                    explorerRpcUrl={data.explorerRpcUrl}
                    actions={
                      <ClosePlanDialog plan={plan.pda} cluster={data.cluster} />
                    }
                  />
                ))}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
