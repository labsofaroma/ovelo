import Link from "next/link";
import {
  Change,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ovelo/ui";
import { PriceCell } from "../../markets/components/PriceCell";
import type { BasketSummary, MarketRow } from "../../markets/schema";
import { changeProp, formatBps } from "../../shared/fixed";
import { formatObservedAt } from "../../shared/freshness";
import { routes } from "../../shared/routes";

/**
 * Weights are integer basis points from lib/sdk. When the issuer does not list a constituent, it
 * is shown as missing rather than its weight being silently redistributed.
 */
export function AllocationTable({
  basket,
  rows,
  asOf,
}: {
  basket: BasketSummary;
  rows: readonly MarketRow[];
  asOf: string;
}) {
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  const listedBps = basket.members.reduce((sum, m) => sum + m.weightBps, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-tile border border-line">
        <Table>
          <TableCaption className="px-4 pb-3 text-left">
            Allocation by weight. Token prices observed{" "}
            {formatObservedAt(asOf) ?? "at an unknown time"}.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Constituent</TableHead>
              <TableHead scope="col" className="text-right md:w-64">
                Weight
              </TableHead>
              <TableHead scope="col" className="text-right">
                Token price
              </TableHead>
              <TableHead scope="col" className="text-right">
                24h change
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {basket.members.map((member) => {
              const row = byMint.get(member.mint);
              return (
                <TableRow key={member.mint}>
                  <TableCell>
                    {row ? (
                      <Link
                        className="group flex min-w-0 flex-col rounded-control focus-ring"
                        href={routes.stock(row.symbol)}
                      >
                        <span className="font-medium text-ink underline-offset-4 group-hover:underline">
                          {row.symbol}
                        </span>
                        <span className="truncate text-caption text-muted">
                          {row.name}
                        </span>
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">
                        {member.symbol}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="flex items-center justify-end gap-3">
                      <span
                        aria-hidden="true"
                        className="relative h-1.5 w-24 overflow-hidden rounded-full bg-raised-2 max-md:hidden"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-accent"
                          style={{
                            width: `${Math.min(100, member.weightBps / 100)}%`,
                          }}
                        />
                      </span>
                      <span className="font-semibold tabular-nums text-ink">
                        {formatBps(member.weightBps)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {row ? (
                      <PriceCell row={row} />
                    ) : (
                      <span className="text-muted">Not observed</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Change percent={changeProp(row?.change24h ?? null)} />
                  </TableCell>
                </TableRow>
              );
            })}
            {basket.missingSymbols.map((symbol) => (
              <TableRow key={`missing-${symbol}`}>
                <TableCell className="font-medium text-ink">{symbol}</TableCell>
                <TableCell className="text-right text-muted" colSpan={3}>
                  Not listed by the issuer catalog right now
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {listedBps !== 10_000 ? (
        <p className="text-caption leading-body text-muted">
          Listed constituents add up to {formatBps(listedBps)} of the
          definition. The rest belongs to constituents that are not listed.
        </p>
      ) : null}
    </div>
  );
}
