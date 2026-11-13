import { Badge } from "@aroma/ui";
import type { BasketSummary } from "../../markets/schema";
import { BasketStatusBadge } from "./BasketStatusBadge";

export function BasketHeader({ basket }: { basket: BasketSummary }) {
  return (
    <header className="flex flex-col gap-3">
      <p className="text-caption font-semibold uppercase tracking-wide text-muted">
        Basket · {basket.ticker}
      </p>
      <h1 className="text-page font-semibold max-md:text-page-mobile">
        {basket.name}
      </h1>
      <div className="flex flex-wrap gap-2">
        {basket.category ? (
          <Badge tone="neutral">{basket.category}</Badge>
        ) : null}
        <BasketStatusBadge basket={basket} />
      </div>
      <p className="max-w-3xl text-body text-muted">{basket.description}</p>
      <p className="text-caption text-muted">
        Constituents and weights come from Aroma’s published basket definition
        (lib/sdk), matched against the issuer catalogs. Not hand-entered
        figures.
      </p>
    </header>
  );
}
