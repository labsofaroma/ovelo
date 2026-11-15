import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AssetAvatar, Badge } from "@ovelo/ui";
import type { BasketSummary, MarketRow } from "../../markets/schema";
import { NextAvatarImage } from "../../shared/components/NextAvatarImage";
import { formatBps, plural } from "../../shared/fixed";
import { routes } from "../../shared/routes";
import { BasketStatusBadge } from "./BasketStatusBadge";
import { WeightBar } from "./WeightBar";

const SHOWN = 4;

/**
 * A basket as one wide row (the redesign's BasketRow). The name is a stretched link over the
 * whole row. Weights are the published integer basis points from lib/sdk.
 */
export function BasketCard({
  basket,
  rowsByMint,
}: {
  basket: BasketSummary;
  /** The snapshot's catalog rows, for each constituent's issuer logo. */
  rowsByMint?: ReadonlyMap<string, MarketRow>;
}) {
  const count = basket.members.length + basket.missingSymbols.length;
  const legs = [...basket.members].sort((a, b) => b.weightBps - a.weightBps);
  const shown = legs.slice(0, SHOWN);
  return (
    <li>
      <article className="group relative flex flex-col gap-4 rounded-tile border border-line bg-raised p-5 transition-colors motion-fast focus-within:border-border-strong hover:border-border-strong md:p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {basket.category ? <Badge>{basket.category}</Badge> : null}
              <span className="text-caption font-medium tracking-wide text-muted">
                {basket.ticker}
              </span>
            </div>
            <h3 className="font-display text-title font-normal tracking-[-0.03em] text-ink">
              <Link
                href={routes.basket(basket.id)}
                className="rounded-control focus-ring after:absolute after:inset-0 after:rounded-tile after:content-['']"
              >
                {basket.name}
              </Link>
            </h3>
            <p className="line-clamp-2 max-w-[62ch] text-small leading-body text-muted">
              {basket.description}
            </p>
          </div>

          <div className="flex flex-col gap-2 md:w-80 md:shrink-0">
            <span className="text-micro font-medium text-muted">
              Allocation
            </span>
            <WeightBar
              weights={legs.map((m) => ({
                key: m.mint,
                weightBps: m.weightBps,
              }))}
            />
            <ul className="flex flex-wrap gap-1.5">
              {shown.map((leg) => {
                const row = rowsByMint?.get(leg.mint);
                return (
                  <li
                    key={leg.mint}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised-2 py-1 pr-2.5 pl-1 text-caption tabular-nums text-ink"
                  >
                    <AssetAvatar
                      asset={{
                        symbol: leg.symbol,
                        mint: leg.mint,
                        issuer: row?.issuer,
                        underlyingSymbol: row?.underlyingSymbol,
                        logoUrl: row?.logoUrl ?? null,
                      }}
                      size="sm"
                      className="size-5 rounded-full"
                      ImageComponent={NextAvatarImage}
                    />
                    {leg.symbol}
                    <span className="text-muted">
                      {formatBps(leg.weightBps)}
                    </span>
                  </li>
                );
              })}
              {legs.length > shown.length ? (
                <li className="inline-flex items-center px-1.5 text-caption text-muted">
                  +{legs.length - shown.length} more
                </li>
              ) : null}
              {legs.length === 0
                ? basket.missingSymbols.slice(0, SHOWN).map((symbol) => (
                    <li
                      key={`missing-${symbol}`}
                      className="inline-flex items-center rounded-full border border-dashed border-line px-2.5 py-1 text-caption text-muted"
                    >
                      {symbol}
                    </li>
                  ))
                : null}
              {legs.length === 0 && basket.missingSymbols.length > SHOWN ? (
                <li className="inline-flex items-center px-1.5 text-caption text-muted">
                  +{basket.missingSymbols.length - SHOWN} more
                </li>
              ) : null}
            </ul>
            {legs.length === 0 ? (
              <span className="text-micro text-muted">
                No constituent is listed by the issuer catalogs right now, so no
                weights are shown.
              </span>
            ) : null}
          </div>

          <ArrowUpRight
            aria-hidden="true"
            className="size-5 shrink-0 text-muted transition-colors group-hover:text-ink max-md:hidden"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
          <BasketStatusBadge basket={basket} />
          <span className="text-micro text-muted">
            {plural(count, "constituent")}
            {basket.missingSymbols.length
              ? ` · not listed: ${basket.missingSymbols.join(", ")}`
              : ""}
          </span>
        </div>
      </article>
    </li>
  );
}
