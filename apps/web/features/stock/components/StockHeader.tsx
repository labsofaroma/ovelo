import { AssetAvatar, Change } from "@aroma/ui";
import { CatalogSourceBadge } from "../../markets/components/CatalogSourceBadge";
import {
  PRICE_SOURCE_LABEL,
  PRICE_SOURCE_URL,
  REFERENCE_SOURCE_LABEL,
} from "../../markets/labels";
import type { MarketRow } from "../../markets/schema";
import { AsOf } from "../../shared/components/AsOf";
import { NextAvatarImage } from "../../shared/components/NextAvatarImage";
import { changeProp, formatCompactUsd, formatUsd } from "../../shared/fixed";
import { STALE_AFTER_MS } from "../../shared/freshness";
import { WatchToggle } from "../../watchlist/components/WatchToggle";

function Figure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-body font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** Token identity, the observed token price with source/time, and the separate share reference. */
export function StockHeader({ row }: { row: MarketRow }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <AssetAvatar
          size="lg"
          asset={{
            symbol: row.symbol,
            mint: row.mint,
            issuer: row.issuer,
            underlyingSymbol: row.underlyingSymbol,
            logoUrl: row.logoUrl,
          }}
          ImageComponent={NextAvatarImage}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-page font-semibold max-md:text-page-mobile">
            {row.symbol}{" "}
            <span className="block text-muted md:inline">
              <span aria-hidden="true" className="max-md:hidden">
                ·{" "}
              </span>
              {row.name}
            </span>
          </h1>
          <CatalogSourceBadge row={row} linked />
        </div>
        <WatchToggle mint={row.mint} symbol={row.symbol} showLabel />
      </div>

      {row.tradingNotice ? (
        <p className="text-small text-warning">{row.tradingNotice}</p>
      ) : null}

      <section
        aria-labelledby="token-price-heading"
        className="flex flex-col gap-2"
      >
        <h2 id="token-price-heading" className="sr-only">
          Token market
        </h2>
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="text-[2rem] font-semibold tabular-nums leading-none">
            {row.price ? (
              formatUsd(row.price)
            ) : (
              <span className="text-title text-muted">
                No token price observed
              </span>
            )}
          </p>
          <Change percent={changeProp(row.change24h)} />
          <span className="text-caption text-muted">
            token price, 24h change
          </span>
        </div>
        <AsOf
          observedAt={row.priceObservedAt}
          source={row.priceSource ? PRICE_SOURCE_LABEL[row.priceSource] : null}
          sourceUrl={row.priceSource ? PRICE_SOURCE_URL[row.priceSource] : null}
          staleAfterMs={STALE_AFTER_MS.tokenPrice}
          label="Observed"
        />
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Figure label="24h token volume">
            {row.volume24h ? formatCompactUsd(row.volume24h) : "Not observed"}
          </Figure>
          <Figure label="Pool liquidity">
            {row.liquidity ? formatCompactUsd(row.liquidity) : "Not observed"}
          </Figure>
          <Figure label="Token market cap">
            {row.marketCap ? formatCompactUsd(row.marketCap) : "Not observed"}
          </Figure>
          <Figure label="Mint">
            <span className="break-all font-mono text-caption">{row.mint}</span>
          </Figure>
        </dl>
        {row.reference ? (
          <div className="rounded-panel border border-line bg-surface p-3 text-small">
            <p>
              Underlying share reference:{" "}
              <strong className="tabular-nums">
                {formatUsd(row.reference.price)}
              </strong>{" "}
              ({REFERENCE_SOURCE_LABEL[row.reference.source]}). A reference
              quote for {row.underlyingSymbol}, not a price you can trade the
              token at.
            </p>
            <AsOf
              observedAt={row.reference.observedAt}
              source={REFERENCE_SOURCE_LABEL[row.reference.source]}
              staleAfterMs={STALE_AFTER_MS.reference}
              label="Updated"
            />
          </div>
        ) : null}
      </section>
    </header>
  );
}
