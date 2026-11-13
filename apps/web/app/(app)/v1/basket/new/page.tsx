import type { Metadata } from "next";
import Link from "next/link";
import { selectableRows } from "@/features/baskets/builder/assets";
import { BuilderForm } from "@/features/baskets/builder/BuilderForm";
import { creatorRoutes } from "@/features/creators/routes";
import { getMarkets } from "@/features/markets/server";
import { AsOf } from "@/features/shared/components/AsOf";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { plural } from "@/features/shared/fixed";
import { STALE_AFTER_MS } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { pageContainer, textLink } from "@/features/shared/styles";
import { assertV1Enabled } from "@/features/shared/v1";

export const revalidate = 120;

export const metadata: Metadata = v1Metadata({
  title: "Build a basket",
  description:
    "Choose tokenized stocks, set exact weights in basis points and preview the allocation. Drafts stay in your browser.",
  path: creatorRoutes.builder,
  noindex: true,
});

export default async function NewBasketPage() {
  assertV1Enabled();
  const markets = await getMarkets();
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-6 py-8`}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          Build a basket
        </h1>
        <p className="max-w-2xl text-body text-muted">
          Choose 2 to 12 tokenized stocks and give each a weight. Weights are
          whole basis points and must add up to exactly 100%. Invited creators
          will publish from here once wallet connection arrives; see the{" "}
          <Link className={textLink} href={creatorRoutes.directory}>
            creator directory
          </Link>
          .
        </p>
      </header>
      {markets.state === "unavailable" ? (
        <DataNotice tone="unavailable" title="Assets are unavailable right now">
          <p>
            The builder needs the issuer catalogs and token prices, which could
            not be loaded. {markets.error.message}
          </p>
        </DataNotice>
      ) : (
        <Builder
          rows={markets.data.rows}
          asOf={markets.data.asOf}
          sources={markets.data.sources}
        />
      )}
    </main>
  );
}

function Builder({
  rows,
  asOf,
  sources,
}: {
  rows: Parameters<typeof selectableRows>[0];
  asOf: string;
  sources: readonly string[];
}) {
  const { rows: market, excluded } = selectableRows(rows);
  const left = excluded.unpriced + excluded.unverified + excluded.halted;
  return (
    <>
      <div className="flex flex-col gap-1">
        <AsOf
          observedAt={asOf}
          source={sources.join(", ") || null}
          staleAfterMs={STALE_AFTER_MS.snapshot}
          label="Asset list and prices as of"
        />
        <p className="text-caption text-muted">
          {plural(market.length, "asset")} can be added: listed and verified by
          the issuer, not halted, with an observed token price.
          {left
            ? ` ${plural(left, "listed asset")} cannot be added right now (${excluded.unpriced} without a token price, ${excluded.unverified} unverified, ${excluded.halted} halted).`
            : ""}
        </p>
      </div>
      {market.length < 2 ? (
        <DataNotice
          tone="warning"
          title="Not enough priced assets to build a basket"
        >
          <p>
            A basket needs at least two assets with an observed token price. Try
            again when prices are available.
          </p>
        </DataNotice>
      ) : null}
      <BuilderForm market={market} asOf={asOf} />
    </>
  );
}
