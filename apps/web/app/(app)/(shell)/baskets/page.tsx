import type { Metadata } from "next";
import { BasketCard } from "@/features/baskets/components/BasketCard";
import { getMarkets } from "@/features/markets/server";
import { AsOf } from "@/features/shared/components/AsOf";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { STALE_AFTER_MS } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";

/** M4: rendered per request (per-request CSP nonce); data comes from the Next data cache. */

export const metadata: Metadata = v1Metadata({
  title: "Thematic baskets",
  description:
    "Themed baskets of tokenized stocks, with constituents and weights from Aroma’s published definitions and their current listing status.",
  path: routes.baskets,
});

export default async function BasketsPage() {
  const markets = await getMarkets();
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-6 py-8`}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          Thematic baskets
        </h1>
        <p className="max-w-2xl text-body text-muted">
          Each basket is a published list of companies and weights. We show
          which constituents the issuers list and price right now.
        </p>
      </header>
      {markets.state === "unavailable" ? (
        <DataNotice
          tone="unavailable"
          title="Baskets are unavailable right now"
        >
          <p>
            Basket constituents are matched against the issuer catalogs, which
            could not be loaded. {markets.error.message}
          </p>
        </DataNotice>
      ) : (
        <>
          <AsOf
            observedAt={markets.data.asOf}
            source={markets.data.sources.join(", ") || null}
            staleAfterMs={STALE_AFTER_MS.snapshot}
            label="Listing status as of"
          />
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {markets.data.baskets.map((basket) => (
              <BasketCard key={basket.id} basket={basket} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
