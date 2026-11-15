"use client";

import {
  AssetAvatar,
  EmptyState,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ovelo/ui";
import { formatUnits } from "@ovelo/ui/format";
import { NextAvatarImage } from "../../shared/components/NextAvatarImage";
import { formatUsd } from "../../shared/fixed";
import { portfolioCopy } from "../copy";
import type { Holding } from "../schema";

const h = portfolioCopy.holdings;

function AssetName({ holding }: { holding: Holding }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <AssetAvatar
        asset={{
          symbol: holding.symbol,
          mint: holding.mint,
          issuer: holding.issuer,
          logoUrl: holding.logoUrl,
        }}
        ImageComponent={NextAvatarImage}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-small font-medium text-ink">
          {holding.symbol}
        </span>
        <span className="truncate text-caption font-normal text-muted">
          {holding.catalog ? holding.name : h.notCatalog}
        </span>
      </span>
    </span>
  );
}

const balance = (holding: Holding) =>
  formatUnits(BigInt(holding.raw), holding.decimals, {
    fractionDigits: Math.min(holding.decimals, 6),
  }).text;

function Price({ holding }: { holding: Holding }) {
  return (
    <>
      {holding.price ? (
        formatUsd(holding.price)
      ) : (
        <span className="text-muted">{h.noPrice}</span>
      )}
      {holding.priceSource ? (
        <span className="block text-caption text-muted">
          {holding.priceSource}
        </span>
      ) : null}
    </>
  );
}

function Value({ holding }: { holding: Holding }) {
  return holding.value ? (
    <span className="font-medium text-ink">{formatUsd(holding.value)}</span>
  ) : (
    <span className="text-muted">{h.unpriced}</span>
  );
}

/** Balances from chain; value only where a token price was observed (with its source and time). */
export function HoldingsTable({ holdings }: { holdings: readonly Holding[] }) {
  if (!holdings.length) return <EmptyState title={h.empty} />;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">{h.caption}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{h.asset}</TableHead>
              <TableHead scope="col" className="text-right">
                {h.balance}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {h.price}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {h.value}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((holding) => (
              <TableRow key={holding.mint}>
                <th
                  scope="row"
                  className="px-4 py-3.5 text-left align-middle font-normal"
                >
                  <AssetName holding={holding} />
                </th>
                <TableCell className="text-right text-ink">
                  {balance(holding)}
                </TableCell>
                <TableCell className="text-right">
                  <Price holding={holding} />
                </TableCell>
                <TableCell className="text-right">
                  <Value holding={holding} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden" aria-label={h.caption}>
        {holdings.map((holding) => (
          <li
            key={holding.mint}
            className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <AssetName holding={holding} />
              <span className="text-right text-small tabular-nums">
                <Value holding={holding} />
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 text-small tabular-nums">
              <span className="text-ink">
                {balance(holding)} {holding.symbol}
              </span>
              <span className="text-right">
                <Price holding={holding} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
