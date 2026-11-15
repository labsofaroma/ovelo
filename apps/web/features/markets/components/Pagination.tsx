import Link from "next/link";
import { routes } from "../../shared/routes";
import { filtersToSearch } from "../filter";
import type { MarketFilters } from "../schema";

const pill =
  "inline-flex min-h-(--ovelo-control-height) items-center justify-center gap-2 rounded-full border border-border-strong px-5 text-small font-medium text-ink transition-colors motion-base hover:bg-raised-2 focus-ring";

export function Pagination({
  filters,
  page,
  pageCount,
}: {
  filters: MarketFilters;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) =>
    `${routes.markets}${filtersToSearch(filters, { page: target })}`;
  return (
    <nav
      aria-label="Market pages"
      className="flex items-center justify-between gap-3"
    >
      {page > 1 ? (
        <Link className={pill} href={href(page - 1)} rel="prev">
          Previous page
        </Link>
      ) : (
        <span />
      )}
      <p className="text-small tabular-nums text-muted" aria-current="page">
        Page {page} of {pageCount}
      </p>
      {page < pageCount ? (
        <Link className={pill} href={href(page + 1)} rel="next">
          Next page
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
