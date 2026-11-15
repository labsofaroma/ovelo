import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Section, Stack } from "@ovelo/ui";
import { BasketCard } from "@/features/baskets/components/BasketCard";
import { getMarkets } from "@/features/markets/server";
import { AsOf } from "@/features/shared/components/AsOf";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { STALE_AFTER_MS } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { linkButton, pageContainer } from "@/features/shared/styles";

/** M4: rendered per request (per-request CSP nonce); data comes from the Next data cache. */

export const metadata: Metadata = v1Metadata({
  title: "Thematic baskets",
  description:
    "Themed baskets of tokenized stocks, with constituents and weights from Ovelo’s published definitions and their current listing status.",
  path: routes.baskets,
});

export default async function BasketsPage() {
  const markets = await getMarkets();
  return (
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Stack>
        <Section
          variant="hero"
          headingLevel="h1"
          eyebrow="Baskets"
          title="Thematic baskets"
          description="Each basket is a published list of companies and weights. We show which constituents the issuers list and price right now."
          actions={
            <Link href={routes.builder} className={linkButton.pill}>
              <Plus aria-hidden="true" className="size-4" />
              Build a basket
            </Link>
          }
        >
          {markets.state === "unavailable" ? (
            <DataNotice
              tone="unavailable"
              title="Baskets are unavailable right now"
            >
              <p>
                Basket constituents are matched against the issuer catalogs,
                which could not be loaded. {markets.error.message}
              </p>
            </DataNotice>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="tabular-nums">
                {markets.data.baskets.length}{" "}
                {markets.data.baskets.length === 1 ? "basket" : "baskets"}
              </Badge>
              <AsOf
                observedAt={markets.data.asOf}
                source={markets.data.sources.join(", ") || null}
                staleAfterMs={STALE_AFTER_MS.snapshot}
                label="Listing status as of"
              />
            </div>
          )}
        </Section>
        {markets.state === "ok" ? (
          <Section
            eyebrow="Curated"
            title="Published baskets"
            description="Constituents and weights come from Ovelo’s published basket definitions, matched against the issuer catalogs."
          >
            <ul className="flex flex-col gap-3">
              {markets.data.baskets.map((basket) => (
                <BasketCard key={basket.id} basket={basket} />
              ))}
            </ul>
          </Section>
        ) : null}
      </Stack>
    </main>
  );
}
