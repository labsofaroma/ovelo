import {
  Section,
  StatTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ovelo/ui";
import { AsOf } from "../../shared/components/AsOf";
import { formatCompactUsd, plural } from "../../shared/fixed";
import { STALE_AFTER_MS } from "../../shared/freshness";
import type { MarketsView } from "../schema";
import { BreadthBar } from "./BreadthBar";
import { MoverCards } from "./MoverCards";

const RANKINGS = [
  { id: "topVolume", label: "Most traded" },
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
] as const;

/**
 * Observed token-market movers and breadth across the catalog (lib/sdk `getMarketPulse`). Not an
 * index and not a sentiment score: every count says how many assets it covers. Server-rendered;
 * only the ranking tabs are a client island (the @ovelo/ui Tabs primitive).
 */
export function PulseStrip({ view }: { view: MarketsView }) {
  const { pulse } = view;
  const rowsBySymbol = new Map(view.rows.map((row) => [row.symbol, row]));
  return (
    <Tabs defaultValue="topVolume">
      <Section
        eyebrow="Last 24 hours"
        title="Market pulse"
        description="The most traded and fastest moving tokenized stocks, observed on Solana token markets."
        actions={
          <TabsList aria-label="Rank movers by">
            {RANKINGS.map(({ id, label }) => (
              <TabsTrigger key={id} value={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      >
        <div className="flex flex-col gap-6">
          {RANKINGS.map(({ id }) => (
            <TabsContent key={id} value={id} className="pt-0">
              <MoverCards
                movers={pulse[id]}
                rowsBySymbol={rowsBySymbol}
                empty="No asset met the liquidity filter."
              />
            </TabsContent>
          ))}
          <div className="flex flex-col gap-5 border-t border-line pt-5">
            <BreadthBar pulse={pulse} />
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Assets with a token price"
                value={`${pulse.pricedAssets} of ${pulse.totalAssets}`}
              />
              <StatTile
                label={`24h token volume (${plural(pulse.volumeCoveredAssets, "asset")})`}
                value={
                  pulse.volume24h
                    ? formatCompactUsd(pulse.volume24h)
                    : "Unavailable"
                }
              />
              <StatTile
                label="Tradable listings"
                value={pulse.tradableAssets}
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-caption text-muted">
                Breadth covers {plural(pulse.coveredAssets, "asset")} with 24h
                data out of {pulse.totalAssets}. Movers exclude listings with
                under $1,000 pool liquidity or a token price more than 15% away
                from the underlying share.
              </p>
              <AsOf
                observedAt={view.asOf}
                source={view.sources.join(", ") || null}
                staleAfterMs={STALE_AFTER_MS.snapshot}
              />
            </div>
          </div>
        </div>
      </Section>
    </Tabs>
  );
}
