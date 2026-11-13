import { formatUsd } from "../../shared/fixed";
import { PRICE_SOURCE_LABEL, REFERENCE_SOURCE_LABEL } from "../labels";
import type { MarketRow } from "../schema";

/**
 * Token price with its source, or the honest "no token price" state. An underlying-share
 * reference quote is shown only as a separately labelled line, never as the token price.
 */
export function PriceCell({ row }: { row: MarketRow }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      {row.price ? (
        <>
          <span className="font-semibold text-ink">{formatUsd(row.price)}</span>
          {row.priceSource ? (
            <span className="text-micro text-muted">
              {PRICE_SOURCE_LABEL[row.priceSource]}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted">No token price</span>
      )}
      {!row.price && row.reference ? (
        <span className="text-micro text-muted">
          Share ref. {formatUsd(row.reference.price)} (
          {REFERENCE_SOURCE_LABEL[row.reference.source]})
        </span>
      ) : null}
    </span>
  );
}
