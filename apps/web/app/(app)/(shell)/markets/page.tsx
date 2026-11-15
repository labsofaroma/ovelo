import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Section, Stack } from "@ovelo/ui";
import { filterRows, filtersToSearch } from "@/features/markets/filter";
import { MarketFilters } from "@/features/markets/components/MarketFilters";
import { MarketTable } from "@/features/markets/components/MarketTable";
import { Pagination } from "@/features/markets/components/Pagination";
import { PulseStrip } from "@/features/markets/components/PulseStrip";
import {
  PAGE_SIZE,
  parseMarketFilters,
  type MarketFilters as Filters,
  type MarketsView,
} from "@/features/markets/schema";
import { getMarkets } from "@/features/markets/server";
import { AsOf } from "@/features/shared/components/AsOf";
import { STALE_AFTER_MS } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { linkButton, pageContainer } from "@/features/shared/styles";

export const metadata: Metadata = v1Metadata({
  title: "Markets",
  description:
    "Tokenized stocks on Solana from the xStocks, PreStocks and Backpack catalogs, with observed token prices, sources and timestamps.",
  path: routes.markets,
});

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * RSC. Filters come from the URL (shareable, server-rendered); the snapshot comes from the Next
 * data cache (features/markets/server.ts), so filtering never refetches providers.
 */
export default async function MarketsPage({ searchParams }: Props) {
  const filters = parseMarketFilters(await searchParams);
  const markets = await getMarkets();

  return (
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Stack>
        <Section
          variant="hero"
          headingLevel="h1"
          eyebrow="Markets"
          title="Tokenized stocks on Solana"
          description="Real stocks issued as tokens by xStocks, PreStocks and Backpack. Prices are what the token trades at on Solana, which can differ from the underlying share."
          actions={
            <Link href={routes.baskets} className={linkButton.pill}>
              See baskets
            </Link>
          }
        >
          {markets.state === "unavailable" ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-body text-ink">
                Market data is unavailable right now
              </p>
              <p className="max-w-2xl text-small text-muted">
                The issuer catalogs and price providers could not be reached, so
                no prices are shown. {markets.error.message} Try again in a few
                minutes.
              </p>
              <Link
                href={`${routes.markets}${filtersToSearch(filters)}`}
                className={linkButton.secondary}
              >
                Refresh
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="tabular-nums">
                {markets.data.rows.length} listings
              </Badge>
              <Badge className="tabular-nums">
                {markets.data.pulse.pricedAssets} priced now
              </Badge>
              <AsOf
                observedAt={markets.data.asOf}
                source={markets.data.sources.join(", ") || null}
                staleAfterMs={STALE_AFTER_MS.snapshot}
                label="Prices as of"
              />
            </div>
          )}
        </Section>
        {markets.state === "unavailable" ? null : (
          <MarketsBody view={markets.data} filters={filters} />
        )}
      </Stack>
    </main>
  );
}

function MarketsBody({
  view,
  filters,
}: {
  view: MarketsView;
  filters: Filters;
}) {
  const result = filterRows(view.rows, filters);
  return (
    <>
      <PulseStrip view={view} />
      <Section
        id="all-listings"
        eyebrow="Catalog"
        title="All listings"
        description="Every tokenized stock from the xStocks, PreStocks and Backpack catalogs, with its observed token price and source."
        actions={
          <span className="inline-flex min-h-7 items-center rounded-full border border-line bg-raised px-3 text-caption font-medium tabular-nums text-ink">
            {view.rows.length}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <MarketFilters filters={filters} />
          <p role="status" className="text-small text-muted">
            {result.total}{" "}
            {result.total === 1 ? "listing matches" : "listings match"}.
          </p>
          {result.rows.length ? (
            <MarketTable
              rows={result.rows}
              asOf={view.asOf}
              caption={`Listings ${(result.page - 1) * PAGE_SIZE + 1}–${(result.page - 1) * PAGE_SIZE + result.rows.length} of ${result.total}.`}
            />
          ) : (
            <p className="rounded-tile border border-dashed border-line px-6 py-10 text-center text-body text-muted">
              No listing matches these filters.
            </p>
          )}
          <Pagination
            filters={filters}
            page={result.page}
            pageCount={result.pageCount}
          />
        </div>
      </Section>
    </>
  );
}
