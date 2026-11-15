import type { Metadata } from "next";
import { Section, Stack } from "@ovelo/ui";
import { MarketNotice } from "@/features/markets/components/MarketNotice";
import { MarketTable } from "@/features/markets/components/MarketTable";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";
import { PageHeader } from "@/features/shell/PageHeader";
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
  const mints = parseWatchlistParam((await searchParams).m);
  const result = mints.length ? await getWatchlist(mints) : null;

  return (
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Stack>
        <PageHeader
          eyebrow="Saved in this browser"
          title="Your watchlist"
          description="Saved in this browser only. Prices come from the same observed market snapshot as Markets."
        />
        <Section title="Watched listings">
          <WatchlistSync renderedMints={mints}>
            {result?.state === "unavailable" ? (
              <MarketNotice
                tone="unavailable"
                title="Market data is unavailable right now"
              >
                <p>
                  Your watched assets are saved, but their prices could not be
                  loaded. {result.error.message}
                </p>
              </MarketNotice>
            ) : result?.state === "ok" ? (
              <div className="flex flex-col gap-4">
                {result.data.status === "partial" ? (
                  <MarketNotice
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
                  <MarketNotice
                    title="Some watched assets are no longer listed"
                    items={result.data.missing.map((mint) => `Mint ${mint}`)}
                  />
                ) : null}
              </div>
            ) : null}
          </WatchlistSync>
        </Section>
      </Stack>
    </main>
  );
}
