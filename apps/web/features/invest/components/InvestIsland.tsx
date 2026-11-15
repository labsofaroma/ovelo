"use client";

import { EmptyState, Section } from "@ovelo/ui";
import { Wallet2 } from "lucide-react";
import { DataNotice } from "../../shared/components/DataNotice";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { ClusterLabel } from "../../wallet/ClusterLabel";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { usePlans } from "../queries";
import { formatChainTime } from "../server/format";
import { ClosePlanDialog } from "./ClosePlanDialog";
import { DevnetSection } from "./DevnetSection";
import { FaucetPanel } from "./FaucetPanel";
import { PlanCard } from "./PlanCard";
import { PlanWizard } from "./PlanWizard";
import type { InvestPageData } from "./types";
import { WizardStep } from "./WizardStep";

/** Client entry for /invest: one devnet (or localnet) wallet boundary, never mainnet. */
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
  return (
    <>
      <DevnetSection
        actions={
          <>
            <span data-testid="cluster-label">
              <ClusterLabel cluster={data.cluster} />
            </span>
            <ConnectButton />
          </>
        }
      >
        {wallet.error || !owner ? (
          <div className="flex flex-col gap-3">
            {wallet.error ? (
              <p
                role="alert"
                data-testid="wallet-error"
                className="rounded-tile bg-down-soft px-4 py-3 text-small text-ink"
              >
                {wallet.error}
              </p>
            ) : null}
            {!owner ? (
              <EmptyState
                title={
                  <span className="inline-flex items-center gap-2">
                    <Wallet2 className="size-5 text-muted" aria-hidden />
                    No wallet connected
                  </span>
                }
                description={`Connect a Solana ${data.cluster} wallet to claim test tokens, create a plan and see its installments.`}
              />
            ) : null}
          </div>
        ) : null}
      </DevnetSection>
      {owner ? <ConnectedSections data={data} owner={owner} /> : null}
    </>
  );
}

function ConnectedSections({
  data,
  owner,
}: {
  data: InvestPageData;
  owner: string;
}) {
  const plans = usePlans(owner);
  return (
    <>
      <Section
        id="new-plan"
        title="New plan"
        description="Claim test tokens, choose what to buy and set the schedule. The server prepares and simulates the plan; nothing is signed until you confirm its review."
        actions={<ClusterLabel cluster={data.cluster} />}
      >
        <ol className="flex flex-col">
          <WizardStep n={1} title="Get test tokens">
            <FaucetPanel
              siteKey={data.turnstileSiteKey}
              nonce={data.nonce}
              cluster={data.cluster}
              explorerRpcUrl={data.explorerRpcUrl}
              fundingSymbol={data.fundingSymbol}
              fundingDecimals={data.fundingDecimals}
              amountRaw={data.faucetAmountRaw}
            />
          </WizardStep>
        </ol>
        <PlanWizard data={data} />
      </Section>
      <Section
        id="your-plans"
        title="Your plans"
        description={`Plans this wallet holds on Solana ${data.cluster}, read from the chain.`}
      >
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
          <EmptyState
            title="No plans yet"
            description="Build one above. It runs with test tokens only."
            action={
              <a
                href="#new-plan"
                className="inline-flex min-h-(--ovelo-control-height-compact) items-center rounded-full border border-line bg-raised-2 px-4 text-caption font-medium text-ink hover:border-border-strong hover:bg-raised focus-ring"
              >
                Start a plan
              </a>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
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
            <p className="border-t border-line pt-3 text-caption text-muted tabular-nums">
              Source: {plans.data.source}. As of{" "}
              {formatChainTime(BigInt(plans.data.asOf))} (chain time).
            </p>
          </div>
        )}
      </Section>
    </>
  );
}
