import { AssetAvatar, Callout, Change, Section, cn } from "@ovelo/ui";
import { CatalogSourceBadge } from "../../markets/components/CatalogSourceBadge";
import {
  ISSUER_LABEL,
  PRICE_SOURCE_LABEL,
  PRICE_SOURCE_URL,
  REFERENCE_SOURCE_LABEL,
} from "../../markets/labels";
import type { MarketRow } from "../../markets/schema";
import { AsOf } from "../../shared/components/AsOf";
import { NextAvatarImage } from "../../shared/components/NextAvatarImage";
import { changeProp, formatUsd } from "../../shared/fixed";
import { STALE_AFTER_MS } from "../../shared/freshness";
import { WatchToggle } from "../../watchlist/components/WatchToggle";

/**
 * Hero card: token identity, the observed token price with source/time, and the separate
 * underlying-share reference (never a price the token trades at).
 */
export function StockHeader({ row }: { row: MarketRow }) {
  return (
    <Section
      variant="hero"
      headingLevel="h1"
      eyebrow={ISSUER_LABEL[row.issuer]}
      title={row.name}
      actions={<WatchToggle mint={row.mint} symbol={row.symbol} showLabel />}
    >
      <div className="flex flex-col gap-6">
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
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-display text-title text-ink">
              {row.symbol}
            </span>
            <span className="text-small text-muted">
              Token price · {row.underlyingSymbol}
            </span>
          </div>
          <CatalogSourceBadge row={row} linked />
        </div>

        <section
          aria-labelledby="token-price-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="token-price-heading" className="sr-only">
            Token market
          </h2>
          <p
            className={cn(
              "font-display leading-none font-normal tabular-nums tracking-[-0.04em]",
              row.price
                ? "text-[2.75rem] text-ink md:text-[4rem]"
                : "text-title text-muted",
            )}
          >
            {row.price ? formatUsd(row.price) : "No token price observed"}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <Change percent={changeProp(row.change24h)} />
              <span className="text-small text-muted">
                token price, 24h change
              </span>
            </span>
            <AsOf
              observedAt={row.priceObservedAt}
              source={
                row.priceSource ? PRICE_SOURCE_LABEL[row.priceSource] : null
              }
              sourceUrl={
                row.priceSource ? PRICE_SOURCE_URL[row.priceSource] : null
              }
              staleAfterMs={STALE_AFTER_MS.tokenPrice}
              label="Observed"
            />
          </div>
        </section>

        {row.reference ? (
          <div className="flex flex-col gap-2 rounded-tile border border-line bg-raised/60 px-4 py-3 text-small">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-muted">Underlying share reference</span>
              <strong className="tabular-nums text-ink">
                {formatUsd(row.reference.price)}
              </strong>
              <span className="text-muted">
                ({REFERENCE_SOURCE_LABEL[row.reference.source]})
              </span>
            </p>
            <p className="text-caption text-muted">
              A reference quote for {row.underlyingSymbol}, not a price you can
              trade the token at.
            </p>
            <AsOf
              observedAt={row.reference.observedAt}
              source={REFERENCE_SOURCE_LABEL[row.reference.source]}
              staleAfterMs={STALE_AFTER_MS.reference}
              label="Updated"
            />
          </div>
        ) : null}

        {row.tradingNotice ? (
          <Callout tone={row.tradingHalted ? "danger" : "warning"}>
            {row.tradingNotice}
          </Callout>
        ) : null}
      </div>
    </Section>
  );
}
