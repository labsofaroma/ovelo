import Link from "next/link";
import { Search } from "lucide-react";
import { routes } from "../../shared/routes";
import { ISSUER_LABEL, KIND_LABEL, SORT_LABEL } from "../labels";
import {
  ISSUER_FILTERS,
  KIND_FILTERS,
  SORTS,
  type MarketFilters as Filters,
} from "../schema";

const control =
  "min-h-(--ovelo-control-height) rounded-full border border-line bg-raised px-4 text-small text-ink transition-colors motion-base hover:border-border-strong focus-ring";
const fieldLabel = "flex flex-col gap-1.5 text-caption font-medium text-muted";
const pill =
  "inline-flex min-h-(--ovelo-control-height) items-center justify-center gap-2 rounded-full px-5 text-small font-semibold transition-colors motion-base focus-ring";

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
      className="flex flex-wrap items-end gap-3"
    >
      <label className={`${fieldLabel} min-w-48 flex-1`}>
        Search symbol or company
        <span className="relative flex">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            maxLength={40}
            autoComplete="off"
            className={`${control} w-full pl-10`}
          />
        </span>
      </label>
      <label className={fieldLabel}>
        Issuer
        <select name="issuer" defaultValue={filters.issuer} className={control}>
          {ISSUER_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All issuers" : ISSUER_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabel}>
        Type
        <select name="kind" defaultValue={filters.kind} className={control}>
          {KIND_FILTERS.map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabel}>
        Sort by
        <select name="sort" defaultValue={filters.sort} className={control}>
          {SORTS.map((value) => (
            <option key={value} value={value}>
              {SORT_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-(--ovelo-control-height) items-center gap-2 rounded-full border border-line bg-raised px-4 text-small text-ink">
        <input
          type="checkbox"
          name="priced"
          value="1"
          defaultChecked={filters.priced}
          className="size-4 accent-(--ovelo-accent) focus-ring"
        />
        Only with a token price
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className={`${pill} bg-accent text-accent-ink hover:bg-accent-hover`}
        >
          Apply filters
        </button>
        <Link
          href={routes.markets}
          className={`${pill} border border-border-strong text-ink hover:bg-raised-2`}
        >
          Reset
        </Link>
      </div>
    </form>
  );
}
