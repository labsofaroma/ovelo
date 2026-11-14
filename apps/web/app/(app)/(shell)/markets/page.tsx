import type { Metadata } from "next";
import { filterRows } from "@/features/markets/filter";
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
import { DataNotice } from "@/features/shared/components/DataNotice";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";

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
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-8 py-8`}
    >
      <header className="flex flex-col gap-2">
        <p className="text-caption font-semibold uppercase tracking-wide text-muted">
          Mainnet data · spot purchases and paper practice
        </p>
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          Markets
        </h1>
        <p className="max-w-2xl text-body text-muted">
          Tokenized stocks listed by their issuers on Solana. Prices are for the
          token, observed on Solana markets; they can differ from the underlying
          share.
        </p>
      </header>

      {markets.state === "unavailable" ? (
        <DataNotice
          tone="unavailable"
          title="Market data is unavailable right now"
        >
          <p>
            The issuer catalogs and price providers could not be reached, so no
            prices are shown. {markets.error.message} Try again in a few
            minutes.
          </p>
        </DataNotice>
      ) : (
        <MarketsBody view={markets.data} filters={filters} />
      )}
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
      {view.status === "partial" ? (
        <DataNotice title="Some market data is missing" items={view.warnings} />
      ) : null}
      <PulseStrip view={view} />
      <section
        aria-labelledby="catalog-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="catalog-heading" className="text-section font-semibold">
          All listings
        </h2>
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
          <p className="rounded-panel border border-line p-6 text-body text-muted">
            No listing matches these filters.
          </p>
        )}
        <Pagination
          filters={filters}
          page={result.page}
          pageCount={result.pageCount}
        />
      </section>
    </>
  );
}
