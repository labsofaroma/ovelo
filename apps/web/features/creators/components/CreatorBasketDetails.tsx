import { ArrowLeft } from "lucide-react";
import { Section, Skeleton, Stack } from "@ovelo/ui";
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
import { linkButtonSmall, pageContainer } from "@/features/shared/styles";
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
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Stack className="pb-8">
        <nav aria-label="Breadcrumb">
          <Link
            className={`${linkButtonSmall.ghost} -ml-2 w-fit`}
            href={creatorRoutes.directory}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Creator baskets
          </Link>
        </nav>
        {page.state === "unavailable" ? (
          <Section variant="hero" headingLevel="h1" title="Creator basket">
            <DataNotice
              tone="unavailable"
              title="This basket is unavailable right now"
            >
              <p>{page.reason}</p>
            </DataNotice>
          </Section>
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
            <Buy creator={page.creator} basket={page.basket} rows={page.rows} />
            <Section
              eyebrow="Weights"
              title="Allocation"
              description="The weights the creator signed, in basis points, with each constituent's observed token price."
            >
              <AllocationTable
                basket={page.basket}
                rows={page.rows}
                asOf={page.view.asOf}
              />
            </Section>
            <Suspense
              fallback={
                <Section
                  aria-busy="true"
                  eyebrow="Performance"
                  title="How these weights would have moved"
                >
                  <div className="flex flex-col gap-3">
                    <p role="status" className="text-small text-muted">
                      Loading daily closes for the performance view…
                    </p>
                    <Skeleton className="h-40 w-full" />
                  </div>
                </Section>
              }
            >
              <Performance
                basket={page.basket}
                rows={page.view.rows}
                range={range}
              />
            </Suspense>
            {stats}
          </>
        )}
      </Stack>
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
  }. Constituents and weights are exactly what the creator signed with their wallet, matched against the issuer catalogs. Ovelo does not endorse creator baskets.`;
  if (basket)
    return (
      <BasketHeader
        basket={basket}
        eyebrow="Creator basket"
        provenance={provenance}
      />
    );
  return (
    <Section
      variant="hero"
      headingLevel="h1"
      eyebrow={`Creator basket · ${creator.ticker}`}
      title={creator.name}
      description={creator.description}
    >
      <p className="max-w-3xl text-caption leading-body text-muted">
        {provenance}
      </p>
    </Section>
  );
}

/** The signed allocation on its own, when the catalog cannot be matched. */
function SignedWeights({ creator }: { creator: CreatorBasketView }) {
  return (
    <Section eyebrow="Weights" title="Signed weights">
      <ul className="flex flex-col text-small">
        {creator.allocations.map((a) => (
          <li
            key={a.mint}
            className="flex justify-between gap-4 border-t border-line py-2.5 tabular-nums first:border-t-0 first:pt-0"
          >
            <span className="font-medium text-ink">{a.symbol}</span>
            <span className="text-muted">{formatBpsPercent(a.weightBps)}</span>
          </li>
        ))}
      </ul>
    </Section>
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
