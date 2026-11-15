import { Badge, Card } from "@ovelo/ui";
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
    <li>
      <Card className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="text-title font-semibold">
            <Link
              href={routes.basket(basket.id)}
              className="underline-offset-4 hover:underline focus-ring"
            >
              {basket.name}
            </Link>
          </h2>
          <Badge tone="neutral">{basket.ticker}</Badge>
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
          <p className="text-small">{basket.description}</p>
        ) : null}
        <table className="w-full text-small">
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
                <th scope="row" className="py-1.5 text-left font-semibold">
                  {allocation.symbol}
                </th>
                <td className="py-1.5 text-right tabular-nums">
                  {formatBps(allocation.weightBps)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </li>
  );
}
