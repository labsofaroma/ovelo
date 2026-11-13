import Link from "next/link";
import { Change } from "@aroma/ui";
import { AsOf } from "../../shared/components/AsOf";
import { DataNotice } from "../../shared/components/DataNotice";
import { changeProp, formatCompactUsd, formatUsd } from "../../shared/fixed";
import { STALE_AFTER_MS } from "../../shared/freshness";
import { routes } from "../../shared/routes";
import { textLink } from "../../shared/styles";
import type { Loaded } from "../../shared/upstream";
import type { LandingSnapshot } from "../server";

/** "The compact dated market snapshot" (.21st/DESIGN.md): observed figures only, with time. */
export function MarketSnapshot({
  snapshot,
}: {
  snapshot: Loaded<LandingSnapshot>;
}) {
  return (
    <section
      aria-labelledby="snapshot-heading"
      data-reveal
      className="flex flex-col gap-4"
    >
      <h2 id="snapshot-heading" className="text-section font-semibold">
        The market, as observed
      </h2>
      {snapshot.state === "unavailable" ? (
        <DataNotice tone="unavailable" title="Market snapshot unavailable">
          <p>
            Live market data could not be loaded just now. No figures are shown.
          </p>
        </DataNotice>
      ) : (
        <>
          <AsOf
            observedAt={snapshot.data.asOf}
            source={snapshot.data.sources.join(", ") || null}
            staleAfterMs={STALE_AFTER_MS.snapshot}
          />
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-panel border border-line bg-surface p-4">
              <dt className="text-caption text-muted">
                Listings with a token price
              </dt>
              <dd className="text-title font-semibold tabular-nums">
                {snapshot.data.pulse.pricedAssets} of{" "}
                {snapshot.data.pulse.totalAssets}
              </dd>
            </div>
            <div className="rounded-panel border border-line bg-surface p-4">
              <dt className="text-caption text-muted">
                24h token volume ({snapshot.data.pulse.volumeCoveredAssets}{" "}
                assets)
              </dt>
              <dd className="text-title font-semibold tabular-nums">
                {snapshot.data.pulse.volume24h
                  ? formatCompactUsd(snapshot.data.pulse.volume24h)
                  : "Unavailable"}
              </dd>
            </div>
            {snapshot.data.highlights.slice(0, 2).map((row) => (
              <div
                key={row.mint}
                className="rounded-panel border border-line bg-surface p-4"
              >
                <dt className="text-caption text-muted">
                  <Link className={textLink} href={routes.stock(row.symbol)}>
                    {row.symbol}
                  </Link>{" "}
                  token price
                </dt>
                <dd className="flex flex-wrap items-baseline gap-2 text-title font-semibold tabular-nums">
                  {row.price ? formatUsd(row.price) : "No price"}
                  <Change percent={changeProp(row.change24h)} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
