import type { Metadata } from "next";
import { MarketTable } from "@/features/markets/components/MarketTable";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";
import { assertV1Enabled } from "@/features/shared/v1";
import { WatchlistSync } from "@/features/watchlist/components/WatchlistSync";
import { parseWatchlistParam } from "@/features/watchlist/schema";
import { getWatchlist } from "@/features/watchlist/server";

export const metadata: Metadata = v1Metadata({
  title: "Your watchlist",
  description:
    "Tokenized assets you follow on this device, with observed prices and sources.",
  path: routes.watchlist,
  noindex: true,
});

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WatchlistPage({ searchParams }: Props) {
  assertV1Enabled();
  const mints = parseWatchlistParam((await searchParams).m);
  const result = mints.length ? await getWatchlist(mints) : null;

  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-6 py-8`}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          Your watchlist
        </h1>
        <p className="max-w-2xl text-body text-muted">
          Saved in this browser only. Prices come from the same observed market
          snapshot as Markets.
        </p>
      </header>
      <WatchlistSync renderedMints={mints}>
        {result?.state === "unavailable" ? (
          <DataNotice
            tone="unavailable"
            title="Market data is unavailable right now"
          >
            <p>
              Your watched assets are saved, but their prices could not be
              loaded. {result.error.message}
            </p>
          </DataNotice>
        ) : result?.state === "ok" ? (
          <div className="flex flex-col gap-4">
            {result.data.status === "partial" ? (
              <DataNotice
                title="Some market data is missing"
                items={result.data.warnings}
              />
            ) : null}
            {result.data.rows.length ? (
              <MarketTable
                rows={result.data.rows}
                asOf={result.data.asOf}
                caption={`${result.data.rows.length} watched listings.`}
              />
            ) : null}
            {result.data.missing.length ? (
              <DataNotice
                title="Some watched assets are no longer listed"
                items={result.data.missing.map((mint) => `Mint ${mint}`)}
              />
            ) : null}
          </div>
        ) : null}
      </WatchlistSync>
    </main>
  );
}
