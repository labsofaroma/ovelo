import { Skeleton } from "@aroma/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AllocationTable } from "@/features/baskets/components/AllocationTable";
import { BasketHeader } from "@/features/baskets/components/BasketHeader";
import { BasketPerformance } from "@/features/baskets/components/BasketPerformance";
import type { PerformanceRange } from "@/features/baskets/schema";
import { getPerformance } from "@/features/baskets/server";
import type { BasketSummary, MarketRow } from "@/features/markets/schema";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { formatObservedAt } from "@/features/shared/freshness";
import { pageContainer, textLink } from "@/features/shared/styles";
import { TradeUnavailable } from "@/features/stock/components/TradePlaceholder";
import { getBasketUsage, getCreatorBasketPage } from "../basket-page";
import { creatorRoutes } from "../routes";
import { formatBpsPercent, type CreatorBasketView } from "../schema";
import { CreatorBasketIsland } from "./CreatorBasketIsland";
import { CreatorUsage } from "./CreatorUsage";

/** "AbCd…WxYz" for display (features/wallet/context is a client module, so not imported here). */
const shortAddress = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

/** `/basket/[id]` for a creator basket (UUID). Curated baskets keep their own page. */
export async function CreatorBasketDetails({
  id,
  range,
}: {
  id: string;
  range: PerformanceRange;
}) {
  const [page, usage] = await Promise.all([
    getCreatorBasketPage(id),
    getBasketUsage(id),
  ]);
  const stats = <CreatorUsage usage={usage} />;
  if (page.state === "not-found") notFound();
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-8 py-8`}
    >
      <nav aria-label="Breadcrumb" className="text-caption">
        <Link className={textLink} href={creatorRoutes.directory}>
          Creator baskets
        </Link>
      </nav>
      {page.state === "unavailable" ? (
        <>
          <h1 className="text-page font-semibold max-md:text-page-mobile">
            Creator basket
          </h1>
          <DataNotice
            tone="unavailable"
            title="This basket is unavailable right now"
          >
            <p>{page.reason}</p>
          </DataNotice>
        </>
      ) : page.state === "catalog-unavailable" ? (
        <>
          <CreatorHeader creator={page.creator} />
          <DataNotice
            tone="unavailable"
            title="Issuer catalogs are unavailable"
          >
            <p>
              The signed weights are below, but they cannot be matched against
              the issuer catalogs right now, so the basket cannot be bought.{" "}
              {page.error.message}
            </p>
          </DataNotice>
          <SignedWeights creator={page.creator} />
          {stats}
        </>
      ) : (
        <>
          <CreatorHeader creator={page.creator} basket={page.basket} />
          {page.creator.status === "archived" ? (
            <DataNotice tone="warning" title="Archived by its creator">
              <p>
                This basket can no longer be bought. Its weights and past
                purchases stay on record.
              </p>
            </DataNotice>
          ) : null}
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
            <Performance
              basket={page.basket}
              rows={page.view.rows}
              range={range}
            />
          </Suspense>
          {stats}
          <Buy creator={page.creator} basket={page.basket} rows={page.rows} />
        </>
      )}
    </main>
  );
}

function CreatorHeader({
  creator,
  basket,
}: {
  creator: CreatorBasketView;
  basket?: BasketSummary;
}) {
  const by = creator.creatorName
    ? `${creator.creatorName} (${shortAddress(creator.creatorWallet)})`
    : shortAddress(creator.creatorWallet);
  const provenance = `Published by ${by}, version ${creator.version}${
    creator.publishedAt
      ? `, ${formatObservedAt(creator.publishedAt) ?? creator.publishedAt}`
      : ""
  }. Constituents and weights are exactly what the creator signed with their wallet, matched against the issuer catalogs. Aroma does not endorse creator baskets.`;
  if (basket)
    return (
      <BasketHeader
        basket={basket}
        eyebrow="Creator basket"
        provenance={provenance}
      />
    );
  return (
    <header className="flex flex-col gap-3">
      <p className="text-caption font-semibold uppercase tracking-wide text-muted">
        Creator basket · {creator.ticker}
      </p>
      <h1 className="text-page font-semibold max-md:text-page-mobile">
        {creator.name}
      </h1>
      <p className="max-w-3xl text-body text-muted">{creator.description}</p>
      <p className="text-caption text-muted">{provenance}</p>
    </header>
  );
}

/** The signed allocation on its own, when the catalog cannot be matched. */
function SignedWeights({ creator }: { creator: CreatorBasketView }) {
  return (
    <section aria-labelledby="signed-heading" className="flex flex-col gap-2">
      <h2 id="signed-heading" className="text-section font-semibold">
        Signed weights
      </h2>
      <ul className="flex flex-col gap-1 text-small">
        {creator.allocations.map((a) => (
          <li key={a.mint} className="flex justify-between gap-4 tabular-nums">
            <span>{a.symbol}</span>
            <span>{formatBpsPercent(a.weightBps)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Performance({
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

/** The same rule as the trade server: every constituent listed, verified and unpaused. */
function Buy({
  creator,
  basket,
  rows,
}: {
  creator: CreatorBasketView;
  basket: BasketSummary;
  rows: readonly MarketRow[];
}) {
  if (creator.status !== "published") return null;
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  const blocked =
    basket.missingSymbols.length > 0 ||
    creator.allocations.some((a) => {
      const row = byMint.get(a.mint);
      return !row || row.tradingHalted || !row.verified;
    });
  const owner = {
    id: creator.id,
    name: creator.name,
    creatorWallet: creator.creatorWallet,
  };
  return (
    <>
      {blocked ? (
        <TradeUnavailable
          name={creator.name}
          reason="One or more constituents are missing, unverified or paused by their issuer. No partial basket is ever bought."
        />
      ) : null}
      <CreatorBasketIsland
        title={
          /\bbasket$/i.test(creator.name)
            ? `Buy ${creator.name}`
            : `Buy the ${creator.name} basket`
        }
        basket={owner}
        target={
          blocked
            ? null
            : {
                kind: "basket",
                basketId: creator.id,
                legs: creator.allocations.map((a) => ({
                  mint: a.mint,
                  symbol: a.symbol,
                  name: byMint.get(a.mint)?.name ?? a.symbol,
                  weightBps: a.weightBps,
                })),
              }
        }
      />
    </>
  );
}
