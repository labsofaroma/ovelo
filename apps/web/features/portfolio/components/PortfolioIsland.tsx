"use client";

import { Callout, Section, Stack } from "@ovelo/ui";
import { AsOf } from "../../shared/components/AsOf";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { STALE_AFTER_MS } from "../../shared/freshness";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { usePortfolio } from "../queries";
import { pnlCopy, portfolioCopy as copy } from "../copy";
import { ActivityList } from "./ActivityList";
import { AllocationBar } from "./AllocationBar";
import { ExportCsv } from "./ExportCsv";
import { HoldingsTable } from "./HoldingsTable";
import { PnlPanel } from "./PnlPanel";
import { PnLSummary } from "./PnLSummary";
import { PortfolioHero } from "./PortfolioHero";
import { WalletCard } from "./WalletCard";

/** Client entry for /portfolio: the connected wallet's holdings, allocation and orders. */
export function PortfolioIsland() {
  return (
    <QueryProvider>
      <WalletBoundary>
        <Stack>
          <PortfolioBody />
        </Stack>
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
      <PortfolioHero connected={false}>
        <div>
          <ConnectButton />
        </div>
        {wallet.error ? (
          <p role="alert" className="text-small text-down">
            {wallet.error}
          </p>
        ) : null}
      </PortfolioHero>
    );
  if (query.isPending)
    return (
      <PortfolioHero connected actions={<ConnectButton />}>
        <p role="status" className="text-small text-muted">
          {copy.reading}
        </p>
      </PortfolioHero>
    );
  if (query.isError)
    return (
      <PortfolioHero connected actions={<ConnectButton />}>
        <Callout tone="danger" title={copy.unavailableTitle}>
          {query.error.message}
        </Callout>
      </PortfolioHero>
    );
  const { portfolio, activity, pnl } = query.data;
  return (
    <>
      <PortfolioHero
        connected
        actions={<ConnectButton />}
        status={
          <AsOf
            observedAt={portfolio.observedAt}
            source={copy.balancesSource}
            staleAfterMs={STALE_AFTER_MS.tokenPrice}
            label={copy.balancesLabel}
          />
        }
      >
        {portfolio.warnings.length ? (
          <Callout tone="warning" role="status" title={copy.warningsTitle}>
            <ul className="list-disc space-y-1 pl-5 text-caption">
              {portfolio.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Callout>
        ) : null}
        <PnLSummary portfolio={portfolio} activity={activity} pnl={pnl} />
      </PortfolioHero>
      <Section
        title={copy.allocation.title}
        description={copy.allocation.description}
      >
        <div className="flex flex-col gap-4">
          <AllocationBar portfolio={portfolio} />
          {portfolio.pricesAsOf ? (
            <AsOf
              observedAt={portfolio.pricesAsOf}
              source={portfolio.sources.slice(1).join(", ") || null}
              staleAfterMs={STALE_AFTER_MS.snapshot}
              label={copy.pricesLabel}
            />
          ) : null}
        </div>
      </Section>
      <Section
        title={copy.holdings.title}
        description={copy.holdings.description}
      >
        <HoldingsTable holdings={portfolio.holdings} />
      </Section>
      <Section
        title={pnlCopy.heading}
        description={pnlCopy.method}
        actions={<ExportCsv />}
      >
        <PnlPanel pnl={pnl} />
      </Section>
      {/* M9: /orders redirects here (/portfolio#activity). */}
      <Section
        id="activity"
        title={copy.activity.title}
        description={copy.activity.description}
      >
        <ActivityList activity={activity} />
      </Section>
      <WalletCard address={address} />
    </>
  );
}
