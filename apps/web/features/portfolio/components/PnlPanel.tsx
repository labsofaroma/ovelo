import { Badge } from "@ovelo/ui";
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
  if (!pnl)
    return <p className="text-small text-muted">{pnlCopy.unavailable}</p>;
  const rows = pnl.rows.filter((r) => r.status !== "funding");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-muted">{pnlCopy.method}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-small">
          <caption className="sr-only">{pnlCopy.heading}</caption>
          <thead>
            <tr className="border-b border-line text-left text-caption text-muted">
              <th scope="col" className="py-2 pr-3 font-normal">
                {pnlCopy.columns.asset}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                {pnlCopy.columns.quantity}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                {pnlCopy.columns.cost}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                {pnlCopy.columns.value}
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                {pnlCopy.columns.pnl}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.mint} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-small">{pnlCopy.realized}</p>
      <section
        aria-labelledby="basket-pnl-heading"
        className="flex flex-col gap-2"
      >
        <h3 id="basket-pnl-heading" className="text-body font-semibold">
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
    <tr className="border-b border-line align-top">
      <th scope="row" className="py-2 pr-3 text-left font-semibold">
        {row.symbol}
        {known ? null : (
          <span className="mt-1 block">
            <Badge tone="neutral">{pnlCopy.status[row.status]}</Badge>
          </span>
        )}
      </th>
      <td className="py-2 pr-3 text-right tabular-nums">{quantity}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {row.costUsdc ? usdc(row.costUsdc) : "—"}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">
        {row.value ? formatUsd(row.value) : pnlCopy.status.unpriced}
        {row.priceSource && row.priceObservedAt ? (
          <span className="block text-caption text-muted">
            {pnlCopy.priceAt(
              row.priceSource,
              new Date(row.priceObservedAt).toUTCString(),
            )}
          </span>
        ) : null}
      </td>
      <td className={`py-2 text-right tabular-nums ${tone(row.unrealized)}`}>
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
      </td>
    </tr>
  );
}

function BasketItem({ basket }: { basket: BasketPnl }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-control border border-line p-3 text-small">
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
