import Link from "next/link";
import { Change } from "@aroma/ui";
import { AsOf } from "../../shared/components/AsOf";
import { changeProp, formatCompactUsd } from "../../shared/fixed";
import { STALE_AFTER_MS } from "../../shared/freshness";
import { routes } from "../../shared/routes";
import { textLink } from "../../shared/styles";
import type { MarketsView } from "../schema";

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-title font-semibold tabular-nums text-ink">
        {children}
      </dd>
    </div>
  );
}

/**
 * Observed token-market breadth across the catalog (lib/sdk `getMarketPulse`). Not an index and
 * not a sentiment score: every count says how many assets it covers.
 */
export function PulseStrip({ view }: { view: MarketsView }) {
  const { pulse } = view;
  return (
    <section aria-labelledby="pulse-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pulse-heading" className="text-section font-semibold">
          Market pulse
        </h2>
        <AsOf
          observedAt={view.asOf}
          source={view.sources.join(", ") || null}
          staleAfterMs={STALE_AFTER_MS.snapshot}
        />
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Assets with a token price">
          {pulse.pricedAssets} of {pulse.totalAssets}
        </Stat>
        <Stat
          label={`Advancing / declining (${pulse.coveredAssets} with 24h data)`}
        >
          {pulse.coveredAssets
            ? `${pulse.advancing} / ${pulse.declining}`
            : "Unavailable"}
        </Stat>
        <Stat label={`24h token volume (${pulse.volumeCoveredAssets} assets)`}>
          {pulse.volume24h ? formatCompactUsd(pulse.volume24h) : "Unavailable"}
        </Stat>
        <Stat label="Tradable listings">{pulse.tradableAssets}</Stat>
      </dl>
      {pulse.gainers.length || pulse.losers.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              ["Top gainers (24h)", pulse.gainers],
              ["Top decliners (24h)", pulse.losers],
            ] as const
          ).map(([title, movers]) => (
            <div
              key={title}
              className="rounded-panel border border-line bg-surface p-4"
            >
              <h3 className="text-small font-semibold">{title}</h3>
              {movers.length ? (
                <ul className="mt-2 flex flex-col gap-2">
                  {movers.map((mover) => (
                    <li
                      key={mover.symbol}
                      className="flex items-center justify-between gap-3"
                    >
                      <Link
                        className={textLink}
                        href={routes.stock(mover.symbol)}
                      >
                        {mover.symbol}
                      </Link>
                      <Change
                        percent={changeProp(mover.change24h)}
                        percentDigits={2}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-caption text-muted">
                  No asset met the liquidity filter.
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-caption text-muted">
        Movers exclude listings with under $1,000 pool liquidity or a token
        price more than 15% away from the underlying share.
      </p>
    </section>
  );
}
