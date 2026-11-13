import { Badge } from "@aroma/ui";
import { ISSUER_LABEL } from "../labels";
import type { MarketRow } from "../schema";

export interface CatalogSourceBadgeProps {
  row: Pick<MarketRow, "issuer" | "sourceUrl" | "verified" | "tradingHalted">;
  /** Link the issuer name to the issuer's catalog. Off inside table rows (one link per row). */
  linked?: boolean;
}

/**
 * Which issuer catalog listed the asset, and its catalog status. Text always carries the meaning;
 * the tone only repeats it.
 */
export function CatalogSourceBadge({
  row,
  linked = false,
}: CatalogSourceBadgeProps) {
  const issuer = ISSUER_LABEL[row.issuer];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone="neutral">
        {linked ? (
          <a
            href={row.sourceUrl}
            rel="noreferrer"
            target="_blank"
            className="underline underline-offset-2"
          >
            {issuer} catalog
          </a>
        ) : (
          issuer
        )}
      </Badge>
      {row.tradingHalted ? (
        <Badge tone="warning">Trading paused</Badge>
      ) : !row.verified ? (
        <Badge tone="warning">Unverified</Badge>
      ) : null}
    </span>
  );
}
