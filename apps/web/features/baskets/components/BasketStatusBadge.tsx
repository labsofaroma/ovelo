import { Badge } from "@ovelo/ui";
import type { BasketSummary } from "../../markets/schema";

/** Availability from lib/sdk, in words. "Complete" is not a promise that a route exists. */
export function BasketStatusBadge({ basket }: { basket: BasketSummary }) {
  if (basket.available)
    return <Badge tone="up">All constituents listed and priced</Badge>;
  if (basket.missingSymbols.length)
    return (
      <Badge tone="warning">
        {basket.missingSymbols.length} not listed by the issuer
      </Badge>
    );
  if (basket.unpricedSymbols.length)
    return (
      <Badge tone="warning">
        {basket.unpricedSymbols.length} without a token price
      </Badge>
    );
  return <Badge tone="warning">Not available</Badge>;
}
