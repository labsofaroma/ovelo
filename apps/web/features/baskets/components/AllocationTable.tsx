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
import { textLink } from "../../shared/styles";

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
    <div className="flex flex-col gap-3">
      <Table>
        <TableCaption className="text-left">
          Allocation by weight. Token prices observed{" "}
          {formatObservedAt(asOf) ?? "at an unknown time"}.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Constituent</TableHead>
            <TableHead scope="col" className="text-right">
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
                    <span className="flex flex-col">
                      <Link
                        className={textLink}
                        href={routes.stock(row.symbol)}
                      >
                        {row.symbol}
                      </Link>
                      <span className="text-caption text-muted">
                        {row.name}
                      </span>
                    </span>
                  ) : (
                    member.symbol
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {formatBps(member.weightBps)}
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
              <TableCell>{symbol}</TableCell>
              <TableCell className="text-right text-muted" colSpan={3}>
                Not listed by the issuer catalog right now
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {listedBps !== 10_000 ? (
        <p className="text-caption text-muted">
          Listed constituents add up to {formatBps(listedBps)} of the
          definition. The rest belongs to constituents that are not listed.
        </p>
      ) : null}
    </div>
  );
}
