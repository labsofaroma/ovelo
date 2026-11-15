import { Callout, Section } from "@ovelo/ui";
import { AsOf } from "../../shared/components/AsOf";
import { STALE_AFTER_MS } from "../../shared/freshness";
import type { Loaded } from "../../shared/upstream";
import type { ResearchView } from "../schema";
import { NewsList } from "./NewsList";
import { PriceChartLazy } from "./PriceChartLazy";
import {
  EventsPanel,
  FinancialsPanel,
  OverviewPanel,
  TechnicalsPanel,
} from "./ResearchPanels";

/**
 * Company research as the redesign's stack of cards: price history, overview, technicals,
 * financials, events and news. Server-rendered; only the chart is a client island.
 */
export function ResearchSections({
  research,
  underlyingSymbol,
}: {
  research: Loaded<ResearchView>;
  underlyingSymbol: string;
}) {
  if (research.state === "unavailable")
    return (
      <Section
        eyebrow="Underlying share"
        title={`Company research: ${underlyingSymbol}`}
      >
        <Callout tone="danger" title="Company research is unavailable">
          Research providers could not be reached. The token data above is
          unaffected. {research.error.message}
        </Callout>
      </Section>
    );

  const data = research.data;
  return (
    <>
      <Section
        eyebrow="Underlying share"
        title="Price history"
        description={`Daily closes of ${underlyingSymbol}, the underlying share. A token’s rights, price and liquidity can differ from the share.`}
        actions={
          <AsOf
            observedAt={data.asOf}
            source={data.sources.map((s) => s.name).join(", ") || null}
            staleAfterMs={STALE_AFTER_MS.research}
            label="Research observed"
          />
        }
      >
        <div className="flex flex-col gap-4">
          {data.warnings.length ? (
            <div role="status">
              <Callout tone="warning" title="Some research is missing">
                <ul className="flex list-disc flex-col gap-1 pl-5 text-caption">
                  {data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Callout>
            </div>
          ) : null}
          {data.closes.length ? (
            <PriceChartLazy closes={data.closes} symbol={underlyingSymbol} />
          ) : (
            <p className="text-small text-muted">
              No daily closes were observed.
            </p>
          )}
        </div>
      </Section>
      <Section
        title="Overview"
        description={`The company behind ${underlyingSymbol}.`}
      >
        <OverviewPanel research={data} />
      </Section>
      <Section
        title="Technicals"
        description="Momentum from daily closes of the underlying share."
      >
        <TechnicalsPanel research={data} />
      </Section>
      <Section
        title="Financials"
        description="Reported financials. They describe the company, not the token’s market value."
      >
        <FinancialsPanel research={data} />
      </Section>
      <Section
        title="Events"
        description="Reported dividends, splits and filings, each linked to its source."
      >
        <EventsPanel research={data} />
      </Section>
      <Section title="News" description="Recent headlines about the company.">
        <NewsList news={data.news} />
      </Section>
    </>
  );
}
