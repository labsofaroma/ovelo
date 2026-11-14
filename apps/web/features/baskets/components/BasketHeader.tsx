import { Badge } from "@aroma/ui";
import type { ReactNode } from "react";
import type { BasketSummary } from "../../markets/schema";
import { BasketStatusBadge } from "./BasketStatusBadge";

export function BasketHeader({
  basket,
  provenance,
  eyebrow = "Basket",
}: {
  basket: BasketSummary;
  /** Where the constituents and weights come from (creator baskets say who signed them). */
  provenance?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="flex flex-col gap-3">
      <p className="text-caption font-semibold uppercase tracking-wide text-muted">
        {eyebrow} · {basket.ticker}
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
        {provenance ??
          "Constituents and weights come from Aroma’s published basket definition (lib/sdk), matched against the issuer catalogs. Not hand-entered figures."}
      </p>
    </header>
  );
}
