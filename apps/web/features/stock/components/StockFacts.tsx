import { Section, StatTile } from "@ovelo/ui";
import { ExternalLink } from "lucide-react";
import {
  ISSUER_LABEL,
  PRICE_SOURCE_LABEL,
  PRICE_SOURCE_URL,
  REFERENCE_SOURCE_LABEL,
} from "../../markets/labels";
import type { MarketRow } from "../../markets/schema";
import { AsOf } from "../../shared/components/AsOf";
import { formatCompactUsd } from "../../shared/fixed";
import { STALE_AFTER_MS } from "../../shared/freshness";
import type { ResearchView } from "../schema";

const KIND = {
  equity: "Equity",
  etf: "ETF",
  "pre-ipo": "Pre-IPO",
  unknown: "Unclassified",
} as const;

const linkClass =
  "focus-ring inline-flex w-fit items-center gap-1 rounded-full text-small font-medium text-ink underline-offset-4 hover:underline";

function SourceLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

/** Token facts: market figures, the mint and every source behind the page's numbers. */
export function StockFacts({
  row,
  research,
}: {
  row: MarketRow;
  research: ResearchView | null;
}) {
  const priceSource = row.priceSource
    ? PRICE_SOURCE_LABEL[row.priceSource]
    : null;
  return (
    <Section
      title="Token facts"
      description="What you would hold, where it trades and where these numbers come from."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="24h token volume"
              value={
                row.volume24h ? formatCompactUsd(row.volume24h) : "Not observed"
              }
            />
            <StatTile
              label="Pool liquidity"
              value={
                row.liquidity ? formatCompactUsd(row.liquidity) : "Not observed"
              }
            />
            <StatTile
              label="Token market cap"
              value={
                row.marketCap ? formatCompactUsd(row.marketCap) : "Not observed"
              }
            />
            <StatTile label="Asset type" value={KIND[row.kind]} />
          </div>
          <AsOf
            observedAt={row.priceObservedAt}
            source={priceSource}
            sourceUrl={
              row.priceSource ? PRICE_SOURCE_URL[row.priceSource] : null
            }
            staleAfterMs={STALE_AFTER_MS.tokenPrice}
            label="Observed"
          />
        </div>

        <div className="flex flex-col gap-2 rounded-tile border border-line bg-raised p-4">
          <span className="text-caption font-medium text-muted">
            {row.verified ? "Verified mainnet mint" : "Mainnet mint"}
          </span>
          <code className="font-mono text-small text-ink [overflow-wrap:anywhere]">
            {row.mint}
          </code>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            <SourceLink href={`https://solscan.io/token/${row.mint}`}>
              View on Solscan
            </SourceLink>
            <SourceLink href={row.sourceUrl}>
              {`${ISSUER_LABEL[row.issuer]} catalog`}
            </SourceLink>
          </div>
        </div>

        <dl className="flex flex-col divide-y divide-line rounded-tile border border-line px-4">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
            <dt className="text-muted">Token price source</dt>
            <dd className="text-ink">{priceSource ?? "Not observed"}</dd>
          </div>
          {row.reference ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
              <dt className="text-muted">Share reference source</dt>
              <dd className="text-ink">
                {REFERENCE_SOURCE_LABEL[row.reference.source]}
              </dd>
            </div>
          ) : null}
          {research?.sources.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-small">
              <dt className="text-muted">Research sources</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1">
                {research.sources.map((source) => (
                  <SourceLink key={source.url} href={source.url}>
                    {source.name}
                  </SourceLink>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </Section>
  );
}
