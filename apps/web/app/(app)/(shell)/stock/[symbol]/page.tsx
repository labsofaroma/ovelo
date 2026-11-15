import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Callout, Section, Stack } from "@ovelo/ui";
import { PRICE_SOURCE_LABEL } from "@/features/markets/labels";
import { formatUsd } from "@/features/shared/fixed";
import { formatObservedAt } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { linkButtonSmall, pageContainer } from "@/features/shared/styles";
import { ResearchSections } from "@/features/stock/components/ResearchSections";
import { StickyBuyBar } from "@/features/stock/components/StickyBuyBar";
import { StockFacts } from "@/features/stock/components/StockFacts";
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
  const { symbol } = await params;
  const page = await getStockPage(symbol);
  if (page.state === "not-found") notFound();
  const current =
    page.state === "ok"
      ? page.lookup.row.symbol
      : decodeURIComponentSafe(symbol);

  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-4 py-6 pb-24 md:gap-5 md:py-8 lg:pb-20`}
    >
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-caption"
      >
        <Link
          className={`${linkButtonSmall.ghost} -ml-2`}
          href={routes.markets}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Markets
        </Link>
        <span aria-hidden="true" className="text-muted">
          /
        </span>
        <span aria-current="page" className="text-muted">
          {current}
        </span>
      </nav>

      {page.state === "unavailable" ? (
        <Section variant="hero" headingLevel="h1" title={current}>
          <Callout tone="danger" title="Market data is unavailable right now">
            The issuer catalog could not be loaded, so this listing and its
            price cannot be shown. {page.error.message} Try again in a few
            minutes.
          </Callout>
        </Section>
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
  const tradable = !row.tradingHalted && row.verified;
  const observed = row.priceObservedAt
    ? formatObservedAt(row.priceObservedAt)
    : null;
  return (
    <Stack>
      <StockHeader row={row} />
      {tradable ? (
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
      ) : (
        <TradeUnavailable
          name={row.symbol}
          reason={
            row.tradingHalted
              ? "The issuer has paused trading for this asset."
              : "This listing is not verified by its issuer, so it cannot be bought here."
          }
        />
      )}
      <ResearchSections
        research={research}
        underlyingSymbol={row.underlyingSymbol}
      />
      <StockFacts
        row={row}
        research={research.state === "ok" ? research.data : null}
      />
      {tradable ? (
        <StickyBuyBar
          label={`Buy ${row.symbol}`}
          detail={
            row.price && row.priceSource && observed ? (
              <>
                <span className="tabular-nums text-ink">
                  {formatUsd(row.price)}
                </span>
                <span>
                  {PRICE_SOURCE_LABEL[row.priceSource]} ·{" "}
                  <time dateTime={row.priceObservedAt ?? undefined}>
                    {observed}
                  </time>
                </span>
              </>
            ) : (
              <span>No token price observed</span>
            )
          }
        />
      ) : null}
    </Stack>
  );
}
