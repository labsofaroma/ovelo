import Link from "next/link";
import {
  AssetAvatar,
  Change,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ovelo/ui";
import { NextAvatarImage } from "../../shared/components/NextAvatarImage";
import { changeProp, formatCompactUsd } from "../../shared/fixed";
import { formatObservedAt } from "../../shared/freshness";
import { routes } from "../../shared/routes";
import { WatchToggle } from "../../watchlist/components/WatchToggle";
import type { MarketRow } from "../schema";
import { CatalogSourceBadge } from "./CatalogSourceBadge";
import { PriceCell } from "./PriceCell";

export interface MarketTableProps {
  rows: readonly MarketRow[];
  asOf: string;
  caption: string;
  /** Hide the watch column (e.g. a compact table on another page). */
  watchable?: boolean;
}

/** Server-rendered market table. Only the per-row watch star is a client island. */
export function MarketTable({
  rows,
  asOf,
  caption,
  watchable = true,
}: MarketTableProps) {
  return (
    <Table>
      <TableCaption className="text-left">
        {caption} Snapshot {formatObservedAt(asOf) ?? "time unavailable"}.
        Figures are token-market observations; a missing value means it was not
        observed.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Asset</TableHead>
          <TableHead scope="col" className="text-right">
            Token price
          </TableHead>
          <TableHead scope="col" className="text-right">
            24h change
          </TableHead>
          <TableHead scope="col" className="text-right max-md:hidden">
            24h volume
          </TableHead>
          <TableHead scope="col" className="text-right max-lg:hidden">
            Market cap
          </TableHead>
          <TableHead scope="col" className="max-lg:hidden">
            Catalog
          </TableHead>
          {watchable ? (
            <TableHead scope="col">
              <span className="sr-only">Watchlist</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.mint}>
            <TableCell>
              <span className="flex items-center gap-3">
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
                <span className="flex min-w-0 flex-col">
                  <Link
                    href={routes.stock(row.symbol)}
                    className="font-semibold text-ink underline-offset-2 hover:underline focus-ring rounded-badge"
                  >
                    {row.symbol}
                  </Link>
                  <span className="truncate text-caption text-muted">
                    {row.name}
                  </span>
                </span>
              </span>
            </TableCell>
            <TableCell className="text-right">
              <PriceCell row={row} />
            </TableCell>
            <TableCell className="text-right">
              <Change percent={changeProp(row.change24h)} />
            </TableCell>
            <TableCell className="text-right max-md:hidden">
              {row.volume24h ? (
                formatCompactUsd(row.volume24h)
              ) : (
                <span className="text-muted">Not observed</span>
              )}
            </TableCell>
            <TableCell className="text-right max-lg:hidden">
              {row.marketCap ? (
                formatCompactUsd(row.marketCap)
              ) : (
                <span className="text-muted">Not observed</span>
              )}
            </TableCell>
            <TableCell className="max-lg:hidden">
              <CatalogSourceBadge row={row} />
            </TableCell>
            {watchable ? (
              <TableCell className="w-12">
                <WatchToggle mint={row.mint} symbol={row.symbol} />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
