import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AsOf } from "@/features/shared/components/AsOf";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { STALE_AFTER_MS } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer, textLink } from "@/features/shared/styles";
import { assertV1Enabled } from "@/features/shared/v1";
import { PriceChartLazy } from "@/features/stock/components/PriceChartLazy";
import { ResearchTabs } from "@/features/stock/components/ResearchTabs";
import { StockHeader } from "@/features/stock/components/StockHeader";
import { TradeUnavailable } from "@/features/stock/components/TradePlaceholder";
import { TradeIsland } from "@/features/trade/components/TradeIsland";
import { getStockPage } from "@/features/stock/server";

type Props = { params: Promise<{ symbol: string }> };

/**
 * M4: v1 HTML renders per request (the CSP nonce is per request, see RootDocument); the market
 * snapshot and research still come from the Next data cache.
 */

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const page = await getStockPage(symbol);
  if (page.state !== "ok")
    return { title: "Stock", robots: { index: false, follow: false } };
  const { row } = page.lookup;
  return v1Metadata({
    title: `${row.symbol} · ${row.name}`,
    description: `${row.name} (${row.symbol}) tokenized stock on Solana: observed token price, company research and news, each with its source and time.`,
    path: routes.stock(row.symbol),
  });
}

export default async function StockPage({ params }: Props) {
  assertV1Enabled();
  const { symbol } = await params;
  const page = await getStockPage(symbol);
  if (page.state === "not-found") notFound();

  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-8 py-8`}
    >
      <nav aria-label="Breadcrumb" className="text-caption">
        <Link className={textLink} href={routes.markets}>
          Markets
        </Link>
        <span aria-hidden="true" className="text-muted">
          {" "}
          /{" "}
        </span>
        <span aria-current="page" className="text-muted">
          {page.state === "ok"
            ? page.lookup.row.symbol
            : decodeURIComponentSafe(symbol)}
        </span>
      </nav>

      {page.state === "unavailable" ? (
        <>
          <h1 className="text-page font-semibold max-md:text-page-mobile">
            {decodeURIComponentSafe(symbol)}
          </h1>
          <DataNotice
            tone="unavailable"
            title="Market data is unavailable right now"
          >
            <p>
              The issuer catalog could not be loaded, so this listing and its
              price cannot be shown. {page.error.message} Try again in a few
              minutes.
            </p>
          </DataNotice>
        </>
      ) : (
        <StockBody page={page} />
      )}
    </main>
  );
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value).slice(0, 24);
  } catch {
    return "Stock";
  }
}

function StockBody({
  page,
}: {
  page: Extract<Awaited<ReturnType<typeof getStockPage>>, { state: "ok" }>;
}) {
  const { row } = page.lookup;
  const research = page.research;
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <StockHeader row={row} />
        {row.tradingHalted || !row.verified ? (
          <TradeUnavailable
            name={row.symbol}
            reason={
              row.tradingHalted
                ? "The issuer has paused trading for this asset."
                : "This listing is not verified by its issuer, so it cannot be bought here."
            }
          />
        ) : (
          <TradeIsland
            title={`Buy ${row.symbol}`}
            target={{
              kind: "spot",
              mint: row.mint,
              legs: [
                {
                  mint: row.mint,
                  symbol: row.symbol,
                  name: row.name,
                  weightBps: 10_000,
                },
              ],
            }}
          />
        )}
      </div>

      <section
        aria-labelledby="research-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="research-heading" className="text-section font-semibold">
            Company research: {row.underlyingSymbol}
          </h2>
          <p className="text-small text-muted">
            About the underlying company. A token’s rights, price and liquidity
            can differ from the share.
          </p>
        </div>
        {research.state === "unavailable" ? (
          <DataNotice
            tone="unavailable"
            title="Company research is unavailable"
          >
            <p>
              Research providers could not be reached. The token data above is
              unaffected. {research.error.message}
            </p>
          </DataNotice>
        ) : (
          <>
            {research.data.warnings.length ? (
              <DataNotice
                title="Some research is missing"
                items={research.data.warnings}
              />
            ) : null}
            <section
              aria-labelledby="chart-heading"
              className="flex flex-col gap-2"
            >
              <h3 id="chart-heading" className="text-title font-semibold">
                Underlying share, daily close
              </h3>
              {research.data.closes.length ? (
                <PriceChartLazy
                  closes={research.data.closes}
                  symbol={row.underlyingSymbol}
                />
              ) : (
                <p className="text-small text-muted">
                  No daily closes were observed.
                </p>
              )}
              <AsOf
                observedAt={research.data.asOf}
                source={
                  research.data.sources.map((s) => s.name).join(", ") || null
                }
                staleAfterMs={STALE_AFTER_MS.research}
                label="Research observed"
              />
            </section>
            <ResearchTabs research={research.data} />
            {research.data.sources.length ? (
              <p className="text-caption text-muted">
                Sources:{" "}
                {research.data.sources.map((source, index) => (
                  <span key={source.url}>
                    {index ? ", " : null}
                    <a
                      className={textLink}
                      href={source.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.name}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
