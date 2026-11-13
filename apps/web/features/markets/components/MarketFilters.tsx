import Link from "next/link";
import { routes } from "../../shared/routes";
import { linkButton, textLink } from "../../shared/styles";
import { ISSUER_LABEL, KIND_LABEL, SORT_LABEL } from "../labels";
import {
  ISSUER_FILTERS,
  KIND_FILTERS,
  SORTS,
  type MarketFilters as Filters,
} from "../schema";

const control =
  "min-h-(--aroma-control-height) rounded-control border border-border-strong bg-surface px-3 text-small text-ink focus-ring";

/**
 * A plain GET form: filters live in the URL, so every view is shareable, server-rendered and
 * works without JavaScript. No client island needed.
 */
export function MarketFilters({ filters }: { filters: Filters }) {
  return (
    <form
      method="get"
      action={routes.markets}
      role="search"
      aria-label="Filter markets"
      className="flex flex-wrap items-end gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-caption font-semibold text-muted">
        Search symbol or company
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          maxLength={40}
          autoComplete="off"
          className={control}
        />
      </label>
      <label className="flex flex-col gap-1 text-caption font-semibold text-muted">
        Issuer
        <select name="issuer" defaultValue={filters.issuer} className={control}>
          {ISSUER_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All issuers" : ISSUER_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-caption font-semibold text-muted">
        Type
        <select name="kind" defaultValue={filters.kind} className={control}>
          {KIND_FILTERS.map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-caption font-semibold text-muted">
        Sort by
        <select name="sort" defaultValue={filters.sort} className={control}>
          {SORTS.map((value) => (
            <option key={value} value={value}>
              {SORT_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-(--aroma-control-height) items-center gap-2 text-small text-ink">
        <input
          type="checkbox"
          name="priced"
          value="1"
          defaultChecked={filters.priced}
          className="size-5 accent-(--aroma-accent) focus-ring"
        />
        Only with a token price
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={linkButton.primary}>
          Apply filters
        </button>
        <Link href={routes.markets} className={textLink}>
          Reset
        </Link>
      </div>
    </form>
  );
}
