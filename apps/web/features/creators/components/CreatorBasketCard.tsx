import { Badge } from "@ovelo/ui";
import Link from "next/link";
import { routes } from "../../shared/routes";
import { formatBps, plural } from "../../shared/fixed";
import { formatDay } from "../../shared/freshness";
import type { CreatorBasketView } from "../schema";

const shortWallet = (wallet: string) =>
  `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

/** One published creator basket: who made it, which version, when, and its exact weights. */
export function CreatorBasketCard({ basket }: { basket: CreatorBasketView }) {
  const published = basket.publishedAt ? formatDay(basket.publishedAt) : null;
  const headingId = `creator-basket-${basket.id}`;
  return (
    <li className="flex">
      <article
        aria-labelledby={headingId}
        className="relative flex w-full flex-col gap-4 rounded-tile border border-line bg-raised p-5 transition-colors motion-base focus-within:border-border-strong hover:border-border-strong"
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            id={headingId}
            className="min-w-0 font-display text-title font-medium tracking-[-0.02em] text-ink"
          >
            <Link
              href={routes.basket(basket.id)}
              className="rounded-badge underline-offset-4 hover:underline focus-ring"
            >
              {basket.name}
            </Link>
          </h3>
          <Badge tone="neutral" className="shrink-0">
            {basket.ticker}
          </Badge>
        </div>
        <p className="text-caption text-muted">
          By {basket.creatorName ?? "an unnamed creator"} (
          <span title={basket.creatorWallet} className="font-mono">
            {shortWallet(basket.creatorWallet)}
          </span>
          ) · Version {basket.version}
          {published ? ` · published ${published}` : ""}
        </p>
        {basket.description ? (
          <p className="text-small leading-body text-muted">
            {basket.description}
          </p>
        ) : null}
        <table className="mt-auto w-full text-small">
          <caption className="sr-only">
            Allocation of {basket.name},{" "}
            {plural(basket.allocations.length, "asset")}
          </caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {basket.allocations.map((allocation) => (
              <tr key={allocation.mint} className="border-t border-line">
                <th scope="row" className="py-2 text-left font-medium text-ink">
                  {allocation.symbol}
                </th>
                <td className="py-2 text-right text-muted tabular-nums">
                  {formatBps(allocation.weightBps)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </li>
  );
}
