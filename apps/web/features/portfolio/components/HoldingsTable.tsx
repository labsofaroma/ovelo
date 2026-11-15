import { formatUnits } from "@ovelo/ui/format";
import { formatUsd } from "../../shared/fixed";
import type { Holding } from "../schema";

/** Balances from chain; value only where a token price was observed (with its source and time). */
export function HoldingsTable({ holdings }: { holdings: readonly Holding[] }) {
  if (!holdings.length)
    return (
      <p className="text-small text-muted">No token balances in this wallet.</p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">Token holdings</caption>
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              Asset
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Balance
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Price
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={h.mint} className="border-b border-line">
              <th scope="row" className="py-2 pr-4 text-left font-medium">
                {h.symbol}
                <span className="block text-caption font-normal text-muted">
                  {h.catalog ? h.name : "Not in the issuer catalog"}
                </span>
              </th>
              <td className="py-2 pr-4 text-right tabular-nums">
                {
                  formatUnits(BigInt(h.raw), h.decimals, {
                    fractionDigits: Math.min(h.decimals, 6),
                  }).text
                }
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {h.price ? (
                  formatUsd(h.price)
                ) : (
                  <span className="text-muted">No token price</span>
                )}
                {h.priceSource ? (
                  <span className="block text-caption text-muted">
                    {h.priceSource}
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-right tabular-nums">
                {h.value ? (
                  formatUsd(h.value)
                ) : (
                  <span className="text-muted">Unpriced</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
