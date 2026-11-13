import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@aroma/ui";
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
import { assertV1Enabled } from "@/features/shared/v1";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
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
  assertV1Enabled();
  const { id } = await params;
  const range = parseRange((await searchParams).range);
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
          <p className="rounded-panel border border-line bg-surface p-4 text-small text-muted">
            Buying a basket from your wallet arrives with wallet trading.
            Nothing on this page is a quote or an offer.
          </p>
        </>
      )}
    </main>
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
