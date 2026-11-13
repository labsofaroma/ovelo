import Link from "next/link";
import { routes } from "../../shared/routes";
import { linkButton } from "../../shared/styles";
import { filtersToSearch } from "../filter";
import type { MarketFilters } from "../schema";

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
        <Link className={linkButton.secondary} href={href(page - 1)} rel="prev">
          Previous page
        </Link>
      ) : (
        <span />
      )}
      <p className="text-small text-muted" aria-current="page">
        Page {page} of {pageCount}
      </p>
      {page < pageCount ? (
        <Link className={linkButton.secondary} href={href(page + 1)} rel="next">
          Next page
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
