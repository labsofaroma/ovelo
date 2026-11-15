import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@ovelo/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AllocationTable } from "@/features/baskets/components/AllocationTable";
import { BasketHeader } from "@/features/baskets/components/BasketHeader";
import { BasketPerformance } from "@/features/baskets/components/BasketPerformance";
import { parseRange } from "@/features/baskets/schema";
import { getBasketPage, getPerformance } from "@/features/baskets/server";
import type { BasketSummary, MarketRow } from "@/features/markets/schema";
import type { PerformanceRange } from "@/features/baskets/schema";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer, textLink } from "@/features/shared/styles";
import { lookupCreatorBasket } from "@/features/creators/basket-page";
import { CreatorBasketDetails } from "@/features/creators/components/CreatorBasketDetails";
import { creatorBasketId } from "@/features/trade/server/creator-target";
import { TradeUnavailable } from "@/features/stock/components/TradePlaceholder";
import { TradeIsland } from "@/features/trade/components/TradeIsland";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const creatorId = creatorBasketId(id);
  if (creatorId) {
    const basket = await lookupCreatorBasket(creatorId);
    if (!basket || basket === "unavailable")
      return {
        title: "Creator basket",
        robots: { index: false, follow: false },
      };
    return v1Metadata({
      title: `${basket.name} creator basket`,
      description: `${basket.name} (${basket.ticker}): a creator-published basket of tokenized stocks, with the weights its creator signed.`,
      path: routes.basket(basket.id),
      noindex: basket.status !== "published",
    });
  }
  const page = await getBasketPage(id);
  if (page.state !== "ok")
    return { title: "Basket", robots: { index: false, follow: false } };
  return v1Metadata({
    title: `${page.basket.name} basket`,
    description: `${page.basket.name} (${page.basket.ticker}): constituents, weights and listing status of a themed basket of tokenized stocks.`,
    path: routes.basket(page.basket.id),
  });
}

export default async function BasketPage({ params, searchParams }: Props) {
  const { id } = await params;
  const range = parseRange((await searchParams).range);
  const creatorId = creatorBasketId(id);
  if (creatorId) return <CreatorBasketDetails id={creatorId} range={range} />;
  const page = await getBasketPage(id);
  if (page.state === "not-found") notFound();

  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-8 py-8`}
    >
      <nav aria-label="Breadcrumb" className="text-caption">
        <Link className={textLink} href={routes.baskets}>
          Baskets
        </Link>
      </nav>
      {page.state === "unavailable" ? (
        <>
          <h1 className="text-page font-semibold max-md:text-page-mobile">
            Basket
          </h1>
          <DataNotice
            tone="unavailable"
            title="This basket is unavailable right now"
          >
            <p>
              Its constituents could not be matched because the issuer catalogs
              could not be loaded. {page.error.message}
            </p>
          </DataNotice>
        </>
      ) : (
        <>
          <BasketHeader basket={page.basket} />
          <section
            aria-labelledby="allocation-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="allocation-heading" className="text-section font-semibold">
              Allocation
            </h2>
            <AllocationTable
              basket={page.basket}
              rows={page.rows}
              asOf={page.view.asOf}
            />
          </section>
          <Suspense
            fallback={
              <section aria-busy="true" className="flex flex-col gap-3">
                <p role="status" className="text-small text-muted">
                  Loading daily closes for the performance view…
                </p>
                <Skeleton className="h-40 w-full" />
              </section>
            }
          >
            <PerformanceSection
              basket={page.basket}
              rows={page.view.rows}
              range={range}
            />
          </Suspense>
          <BasketBuy basket={page.basket} rows={page.rows} />
        </>
      )}
    </main>
  );
}

/** Buy the whole basket (one order, every constituent) or show why it cannot be bought. */
function BasketBuy({
  basket,
  rows,
}: {
  basket: BasketSummary;
  rows: readonly MarketRow[];
}) {
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  // A live order needs every constituent listed, verified and unpaused. A missing catalog token
  // price does not block it: the Jupiter quote and the mainnet simulation price the order.
  const blocked =
    basket.missingSymbols.length > 0 ||
    basket.members.some((m) => {
      const row = byMint.get(m.mint);
      return !row || row.tradingHalted || !row.verified;
    });
  if (blocked)
    return (
      <TradeUnavailable
        name={basket.name}
        reason="One or more constituents are missing, unverified or paused by their issuer. No partial basket is ever bought."
      />
    );
  return (
    <TradeIsland
      title={`Buy the ${basket.name} basket`}
      target={{
        kind: "basket",
        basketId: basket.id,
        legs: basket.members.map((m) => ({
          mint: m.mint,
          symbol: m.symbol,
          name: byMint.get(m.mint)?.name ?? m.symbol,
          weightBps: m.weightBps,
        })),
      }}
    />
  );
}

/** Streams in after the allocation table; history can take seconds on a cold cache. */
async function PerformanceSection({
  basket,
  rows,
  range,
}: {
  basket: BasketSummary;
  rows: readonly MarketRow[];
  range: PerformanceRange;
}) {
  return (
    <BasketPerformance
      basketId={basket.id}
      range={range}
      performance={await getPerformance(basket, rows, range)}
    />
  );
}
