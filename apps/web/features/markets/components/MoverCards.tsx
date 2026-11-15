import Link from "next/link";
import { AssetAvatar, Change } from "@ovelo/ui";
import { NextAvatarImage } from "../../shared/components/NextAvatarImage";
import { changeProp, formatUsd } from "../../shared/fixed";
import { routes } from "../../shared/routes";
import type { MarketRow, Pulse } from "../schema";

type Mover = Pulse["gainers"][number];

/**
 * One row of token cards for a mover ranking. Logo and token price come from the same snapshot's
 * catalog row; a mover without a row still shows its symbol, name and change.
 */
export function MoverCards({
  movers,
  rowsBySymbol,
  empty,
}: {
  movers: readonly Mover[];
  rowsBySymbol: ReadonlyMap<string, MarketRow>;
  empty: string;
}) {
  if (!movers.length)
    return (
      <p className="rounded-tile border border-dashed border-line px-6 py-8 text-center text-small text-muted">
        {empty}
      </p>
    );
  return (
    <ul className="-mx-5 flex gap-3 overflow-x-auto overscroll-x-contain px-5 pt-1 pb-2 md:-mx-8 md:px-8">
      {movers.map((mover) => {
        const row = rowsBySymbol.get(mover.symbol);
        return (
          <li key={mover.symbol} className="w-44 shrink-0 md:w-52">
            <Link
              href={routes.stock(mover.symbol)}
              className="flex h-full flex-col gap-3 rounded-tile border border-line bg-raised p-4 transition-colors motion-fast hover:border-border-strong focus-ring"
            >
              <span className="flex items-center gap-2.5">
                {row ? (
                  <AssetAvatar
                    asset={{
                      symbol: row.symbol,
                      mint: row.mint,
                      issuer: row.issuer,
                      underlyingSymbol: row.underlyingSymbol,
                      logoUrl: row.logoUrl,
                    }}
                    size="sm"
                    ImageComponent={NextAvatarImage}
                  />
                ) : null}
                <span className="min-w-0 truncate text-caption font-semibold text-muted">
                  {mover.symbol}
                </span>
              </span>
              <span className="line-clamp-1 text-small font-medium text-ink">
                {mover.name}
              </span>
              <strong className="mt-auto font-display text-title font-medium tabular-nums text-ink">
                {row?.price ? (
                  formatUsd(row.price)
                ) : (
                  <span className="text-small font-normal text-muted">
                    No token price
                  </span>
                )}
              </strong>
              <span className="flex items-center justify-between gap-2">
                <Change
                  percent={changeProp(mover.change24h)}
                  percentDigits={2}
                />
                <span className="text-micro text-muted">24h</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
