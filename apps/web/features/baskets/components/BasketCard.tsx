import Link from "next/link";
import type { BasketSummary } from "../../markets/schema";
import { routes } from "../../shared/routes";
import { BasketStatusBadge } from "./BasketStatusBadge";

export function BasketCard({ basket }: { basket: BasketSummary }) {
  const count = basket.members.length + basket.missingSymbols.length;
  return (
    <li className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5">
      <p className="text-caption font-semibold uppercase tracking-wide text-muted">
        {basket.ticker}
      </p>
      <h2 className="text-title font-semibold">
        <Link
          href={routes.basket(basket.id)}
          className="text-ink underline-offset-2 hover:underline focus-ring rounded-badge"
        >
          {basket.name}
        </Link>
      </h2>
      <p className="line-clamp-3 text-small text-muted">{basket.description}</p>
      <p className="text-caption text-muted">
        {count} constituents:{" "}
        {basket.members.map((m) => m.symbol).join(", ") || "none listed"}
      </p>
      <BasketStatusBadge basket={basket} />
    </li>
  );
}
