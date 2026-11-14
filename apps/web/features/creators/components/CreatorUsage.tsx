import { formatUnits } from "@aroma/ui";
import { formatObservedAt } from "../../shared/freshness";
import type { UsageView, UsageWindow } from "../schema";

const WINDOW_LABEL: Record<UsageWindow["window"], string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

/** Exact amount in the funding token's units; a mint without known precision stays raw. */
function volumeText(volume: UsageWindow["volume"]): string {
  if (!volume.length) return "None";
  return volume
    .map((v) =>
      v.decimals === null
        ? `${v.raw} raw units of ${v.mint.slice(0, 4)}…`
        : `${formatUnits(BigInt(v.raw), v.decimals, { fractionDigits: v.decimals }).text} ${v.symbol}`,
    )
    .join(" + ");
}

/**
 * Purchases through this basket, from confirmed receipts only (M5b B5). PRODUCT.md: source and
 * as-of time always shown; no purchases is said in words, never shown as zero volume; an outage
 * is unavailable.
 */
export function CreatorUsage({ usage }: { usage: UsageView }) {
  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-3">
      <h2 id="usage-heading" className="text-section font-semibold">
        Purchases
      </h2>
      {usage.state === "unavailable" ? (
        <p className="text-small text-muted">Unavailable: {usage.reason}</p>
      ) : (
        <>
          <p className="text-caption text-muted">
            Source: {usage.source}. As of{" "}
            {formatObservedAt(usage.asOf) ?? usage.asOf}. Pending and failed
            orders are not counted.
          </p>
          {usage.state === "none" ? (
            <p className="text-small">No purchases yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-small">
                <caption className="sr-only">
                  Confirmed purchases by period
                </caption>
                <thead>
                  <tr className="text-left text-caption text-muted">
                    <th scope="col" className="py-1.5 font-semibold">
                      Period
                    </th>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      Purchases
                    </th>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      Buyers
                    </th>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      Volume (funding token)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usage.windows.map((w) => (
                    <tr key={w.window} className="border-t border-line">
                      <th
                        scope="row"
                        className="py-1.5 text-left font-semibold"
                      >
                        {WINDOW_LABEL[w.window]}
                      </th>
                      <td className="py-1.5 text-right tabular-nums">
                        {w.purchases}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {w.buyers}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {volumeText(w.volume)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
