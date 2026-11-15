import { Badge, Section } from "@ovelo/ui";
import type { ReactNode } from "react";
import type { BasketSummary } from "../../markets/schema";
import { plural } from "../../shared/fixed";
import { BasketStatusBadge } from "./BasketStatusBadge";

/** The basket page's hero card: name, ticker, thesis, listing status and where the weights come from. */
export function BasketHeader({
  basket,
  provenance,
  eyebrow = "Basket",
  actions,
}: {
  basket: BasketSummary;
  /** Where the constituents and weights come from (creator baskets say who signed them). */
  provenance?: ReactNode;
  eyebrow?: string;
  /** Links aligned to the header's right edge. */
  actions?: ReactNode;
}) {
  const count = basket.members.length + basket.missingSymbols.length;
  return (
    <Section
      variant="hero"
      headingLevel="h1"
      eyebrow={`${eyebrow} · ${basket.ticker}`}
      title={basket.name}
      description={basket.description}
      actions={actions}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {basket.category ? <Badge>{basket.category}</Badge> : null}
          <Badge className="tabular-nums">{plural(count, "constituent")}</Badge>
          <BasketStatusBadge basket={basket} />
        </div>
        <p className="max-w-3xl text-caption leading-body text-muted">
          {provenance ??
            "Constituents and weights come from Ovelo’s published basket definition (lib/sdk), matched against the issuer catalogs. Not hand-entered figures."}
        </p>
      </div>
    </Section>
  );
}
