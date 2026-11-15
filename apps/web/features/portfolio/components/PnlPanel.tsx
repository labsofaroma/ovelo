import {
  Badge,
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
import { formatUsd, type Fixed } from "../../shared/fixed";
import { pnlCopy } from "../copy";
import type { BasketPnl, PnlRow, PnlView } from "../pnl/schema";

/** Basis points → "+12.34%" with integer math only. */
export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  const abs = Math.abs(bps);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
}

const usdc = (raw: string) => formatUsd({ raw, decimals: 6 });
const signedUsd = (value: Fixed) =>
  `${BigInt(value.raw) > 0n ? "+" : ""}${formatUsd(value)}`;
const tone = (value: Fixed | null) =>
  !value
    ? "text-muted"
    : BigInt(value.raw) > 0n
      ? "text-up"
      : BigInt(value.raw) < 0n
        ? "text-down"
        : "";

/** Per-holding cost basis and unrealized P&L, and per-basket groups (M11 Step 2). */
export function PnlPanel({ pnl }: { pnl: PnlView | null }) {
  if (!pnl) return <EmptyState title={pnlCopy.unavailable} />;
  const rows = pnl.rows.filter((r) => r.status !== "funding");
  return (
    <div className="flex flex-col gap-5">
      <Table className="min-w-[40rem]">
        <TableCaption className="sr-only">{pnlCopy.heading}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{pnlCopy.columns.asset}</TableHead>
            <TableHead scope="col" className="text-right">
              {pnlCopy.columns.quantity}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {pnlCopy.columns.cost}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {pnlCopy.columns.value}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {pnlCopy.columns.pnl}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Row key={row.mint} row={row} />
          ))}
        </TableBody>
      </Table>
      <p className="rounded-tile border border-line bg-raised px-4 py-3 text-small text-muted">
        {pnlCopy.realized}
      </p>
      <section
        aria-labelledby="basket-pnl-heading"
        className="flex flex-col gap-3"
      >
        <h3
          id="basket-pnl-heading"
          className="font-display text-title text-ink"
        >
          {pnlCopy.basketsHeading}
        </h3>
        {pnl.baskets.length === 0 ? (
          <p className="text-small text-muted">{pnlCopy.basketsNone}</p>
        ) : (
          <ul className="grid gap-2">
            {pnl.baskets.map((b) => (
              <BasketItem key={b.basket} basket={b} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ row }: { row: PnlRow }) {
  const quantity = formatUnits(BigInt(row.quantity), row.decimals, {
    fractionDigits: Math.min(row.decimals, 6),
  }).text;
  const known = row.status === "known";
  return (
    <TableRow className="align-top">
      <th
        scope="row"
        className="px-4 py-3.5 text-left align-top font-medium text-ink"
      >
        {row.symbol}
        {known ? null : (
          <span className="mt-1 block">
            <Badge tone="neutral">{pnlCopy.status[row.status]}</Badge>
          </span>
        )}
      </th>
      <TableCell className="text-right align-top">{quantity}</TableCell>
      <TableCell className="text-right align-top">
        {row.costUsdc ? usdc(row.costUsdc) : "—"}
      </TableCell>
      <TableCell className="text-right align-top">
        {row.value ? formatUsd(row.value) : pnlCopy.status.unpriced}
        {row.priceSource && row.priceObservedAt ? (
          <span className="block text-caption text-muted">
            {pnlCopy.priceAt(
              row.priceSource,
              new Date(row.priceObservedAt).toUTCString(),
            )}
          </span>
        ) : null}
      </TableCell>
      <TableCell className={`text-right align-top ${tone(row.unrealized)}`}>
        {row.unrealized ? (
          <>
            {signedUsd(row.unrealized)}
            <span className="block text-caption">
              {formatBps(row.unrealizedBps)}
            </span>
          </>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

function BasketItem({ basket }: { basket: BasketPnl }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-tile border border-line bg-raised px-4 py-3 text-small">
      <span>
        <span className="font-semibold">{basket.name}</span>{" "}
        <span className="text-muted">{pnlCopy.orders(basket.orders)}</span>
      </span>
      {basket.missing ? (
        <Badge tone="neutral">{pnlCopy.status[basket.missing]}</Badge>
      ) : (
        <span className={`tabular-nums ${tone(basket.unrealized)}`}>
          {usdc(basket.costUsdc!)} → {formatUsd(basket.value!)} (
          {signedUsd(basket.unrealized!)}, {formatBps(basket.unrealizedBps)})
        </span>
      )}
    </li>
  );
}
