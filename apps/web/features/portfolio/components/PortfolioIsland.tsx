"use client";

import { AsOf } from "../../shared/components/AsOf";
import { DataNotice } from "../../shared/components/DataNotice";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { STALE_AFTER_MS } from "../../shared/freshness";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { usePortfolio } from "../queries";
import { ActivityList } from "./ActivityList";
import { AllocationDonut } from "./AllocationDonut";
import { HoldingsTable } from "./HoldingsTable";
import { ExportCsv } from "./ExportCsv";
import { PnlPanel } from "./PnlPanel";
import { PnLSummary } from "./PnLSummary";
import { pnlCopy } from "../copy";

/** Client entry for /portfolio: the connected wallet's holdings, allocation and orders. */
export function PortfolioIsland() {
  return (
    <QueryProvider>
      <WalletBoundary>
        <PortfolioBody />
      </WalletBoundary>
    </QueryProvider>
  );
}

function PortfolioBody() {
  const wallet = useWallet();
  const address = wallet.signer?.address ?? null;
  const query = usePortfolio(address);
  if (!address)
    return (
      <section className="flex flex-col items-start gap-3 rounded-panel border border-line bg-surface p-4">
        <p className="text-small">
          Connect a Solana mainnet wallet to see its holdings and the orders you
          placed through Ovelo. Ovelo reads public balances; it never holds your
          funds or keys.
        </p>
        <ConnectButton />
        {wallet.error ? (
          <p role="alert" className="text-small text-down">
            {wallet.error}
          </p>
        ) : null}
      </section>
    );
  if (query.isPending)
    return (
      <p role="status" className="text-small text-muted">
        Reading balances from Solana mainnet…
      </p>
    );
  if (query.isError)
    return (
      <DataNotice
        tone="unavailable"
        title="Your portfolio is unavailable right now"
      >
        <p>{query.error.message}</p>
      </DataNotice>
    );
  const { portfolio, activity, pnl } = query.data;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AsOf
          observedAt={portfolio.observedAt}
          source="Solana mainnet RPC"
          staleAfterMs={STALE_AFTER_MS.tokenPrice}
          label="Balances read"
        />
        <ConnectButton />
      </div>
      {portfolio.warnings.length ? (
        <DataNotice title="Some data is missing" items={portfolio.warnings} />
      ) : null}
      <section
        aria-labelledby="summary-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="summary-heading" className="text-section font-semibold">
          Summary
        </h2>
        <PnLSummary portfolio={portfolio} activity={activity} pnl={pnl} />
      </section>
      <section aria-labelledby="pnl-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pnl-heading" className="text-section font-semibold">
            {pnlCopy.heading}
          </h2>
          <ExportCsv />
        </div>
        <PnlPanel pnl={pnl} />
      </section>
      <section
        aria-labelledby="allocation-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="allocation-heading" className="text-section font-semibold">
          Allocation
        </h2>
        <AllocationDonut portfolio={portfolio} />
        {portfolio.pricesAsOf ? (
          <AsOf
            observedAt={portfolio.pricesAsOf}
            source={portfolio.sources.slice(1).join(", ") || null}
            staleAfterMs={STALE_AFTER_MS.snapshot}
            label="Prices as of"
          />
        ) : null}
      </section>
      <section
        aria-labelledby="holdings-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="holdings-heading" className="text-section font-semibold">
          Holdings
        </h2>
        <HoldingsTable holdings={portfolio.holdings} />
      </section>
      {/* M9: /orders redirects here (/portfolio#activity). */}
      <section
        id="activity"
        aria-labelledby="activity-heading"
        className="flex scroll-mt-6 flex-col gap-3"
      >
        <h2 id="activity-heading" className="text-section font-semibold">
          Activity
        </h2>
        <ActivityList activity={activity} />
      </section>
    </div>
  );
}
