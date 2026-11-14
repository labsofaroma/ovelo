import type { Metadata } from "next";
import Link from "next/link";
import { selectableRows } from "@/features/baskets/builder/assets";
import type { BuilderFormProps } from "@/features/baskets/builder/BuilderForm";
import { BuilderIsland } from "@/features/baskets/builder/BuilderIsland";
import { loadEditableBasket } from "@/features/creators/editable";
import { creatorRoutes } from "@/features/creators/routes";
import { getMarkets } from "@/features/markets/server";
import { AsOf } from "@/features/shared/components/AsOf";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { plural } from "@/features/shared/fixed";
import { STALE_AFTER_MS } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { pageContainer, textLink } from "@/features/shared/styles";
import { assertV1Enabled } from "@/features/shared/v1";

// Dynamic, never ISR: M4's nonce CSP needs a fresh nonce per request, and a prerendered page
// would carry none, so the browser would block the builder's scripts (M4 decision 2).
export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: "Build a basket",
  description:
    "Choose tokenized stocks, set exact weights in basis points, preview the allocation and publish it with your creator wallet. Drafts stay in your browser.",
  path: creatorRoutes.builder,
  noindex: true,
});

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewBasketPage({ searchParams }: Props) {
  assertV1Enabled();
  const from = (await searchParams).from;
  const [markets, editing] = await Promise.all([
    getMarkets(),
    loadEditableBasket(typeof from === "string" ? from : null),
  ]);
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
          publish by signing the basket with their wallet; see the{" "}
          <Link className={textLink} href={creatorRoutes.directory}>
            creator directory
          </Link>
          .
        </p>
      </header>
      {editing.state === "unavailable" ? (
        <DataNotice tone="warning" title="That basket cannot be edited here">
          <p>{editing.reason} You can still build a new basket below.</p>
        </DataNotice>
      ) : null}
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
          {...(editing.state === "ok" ? { initial: editing.initial } : {})}
        />
      )}
    </main>
  );
}

function Builder({
  rows,
  asOf,
  sources,
  initial,
}: {
  rows: Parameters<typeof selectableRows>[0];
  asOf: string;
  sources: readonly string[];
  initial?: BuilderFormProps["initial"];
}) {
  const { rows: market, excluded } = selectableRows(rows);
  const left = excluded.unverified + excluded.halted;
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
          the issuer and not halted, the same rule a purchase uses.
          {excluded.unpriced
            ? ` ${excluded.unpriced} of them have no observed token price right now; the quote prices an order when it is bought.`
            : ""}
          {left
            ? ` ${plural(left, "listed asset")} cannot be added (${excluded.unverified} unverified, ${excluded.halted} halted).`
            : ""}
        </p>
      </div>
      {market.length < 2 ? (
        <DataNotice
          tone="warning"
          title="Not enough tradable assets to build a basket"
        >
          <p>
            A basket needs at least two listed, verified assets that are not
            halted. Try again when the issuer catalogs recover.
          </p>
        </DataNotice>
      ) : null}
      <BuilderIsland
        market={market}
        asOf={asOf}
        {...(initial ? { initial } : {})}
      />
    </>
  );
}
