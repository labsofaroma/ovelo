import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Section, Stack } from "@ovelo/ui";
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
import { routes } from "@/features/shared/routes";
import { linkButton, pageContainer, textLink } from "@/features/shared/styles";

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
  const from = (await searchParams).from;
  const [markets, editing] = await Promise.all([
    getMarkets(),
    loadEditableBasket(typeof from === "string" ? from : null),
  ]);
  return (
    <main id="main-content" className={`${pageContainer} py-6 md:py-8`}>
      <Stack>
        <Section
          variant="hero"
          headingLevel="h1"
          eyebrow="Basket builder"
          title="Build a basket"
          description={
            <>
              Choose 2 to 12 tokenized stocks and give each a weight. Weights
              are whole basis points and must add up to exactly 100%. Invited
              creators publish by signing the basket with their wallet; see the{" "}
              <Link className={textLink} href={creatorRoutes.directory}>
                creator directory
              </Link>
              .
            </>
          }
          actions={
            <>
              <Link className={linkButton.ghost} href={routes.baskets}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                All baskets
              </Link>
              <Link className={linkButton.pill} href={creatorRoutes.directory}>
                Creator directory
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </>
          }
        >
          {markets.state === "unavailable" ? (
            <DataNotice
              tone="unavailable"
              title="Assets are unavailable right now"
            >
              <p>
                The builder needs the issuer catalogs and token prices, which
                could not be loaded. {markets.error.message}
              </p>
            </DataNotice>
          ) : (
            <SnapshotNote
              rows={markets.data.rows}
              asOf={markets.data.asOf}
              sources={markets.data.sources}
            />
          )}
        </Section>
        {editing.state === "unavailable" ? (
          <DataNotice tone="warning" title="That basket cannot be edited here">
            <p>{editing.reason} You can still build a new basket below.</p>
          </DataNotice>
        ) : null}
        {markets.state === "ok" ? (
          <Builder
            rows={markets.data.rows}
            asOf={markets.data.asOf}
            {...(editing.state === "ok" ? { initial: editing.initial } : {})}
          />
        ) : null}
      </Stack>
    </main>
  );
}

/** Where the asset list comes from, and how many assets can be added and why. */
function SnapshotNote({
  rows,
  asOf,
  sources,
}: {
  rows: Parameters<typeof selectableRows>[0];
  asOf: string;
  sources: readonly string[];
}) {
  const { rows: market, excluded } = selectableRows(rows);
  const left = excluded.unverified + excluded.halted;
  return (
    <div className="flex flex-col gap-2">
      <AsOf
        observedAt={asOf}
        source={sources.join(", ") || null}
        staleAfterMs={STALE_AFTER_MS.snapshot}
        label="Asset list and prices as of"
      />
      <p className="max-w-3xl text-caption leading-body text-muted">
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
  );
}

function Builder({
  rows,
  asOf,
  initial,
}: {
  rows: Parameters<typeof selectableRows>[0];
  asOf: string;
  initial?: BuilderFormProps["initial"];
}) {
  const { rows: market } = selectableRows(rows);
  return (
    <>
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
