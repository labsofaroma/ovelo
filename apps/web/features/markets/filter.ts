import { toBigInt, type Fixed } from "../shared/fixed";
import { PAGE_SIZE, type MarketFilters, type MarketRow } from "./schema";

export interface FilteredRows {
  rows: MarketRow[];
  total: number;
  page: number;
  pageCount: number;
}

/** Nulls sort last whatever the direction: a missing value is never "the smallest". */
function byFixedDesc(pick: (row: MarketRow) => Fixed | null) {
  return (a: MarketRow, b: MarketRow): number => {
    const x = pick(a);
    const y = pick(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    const diff = toBigInt(y) - toBigInt(x);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  };
}

const SORTERS: Record<
  MarketFilters["sort"],
  (a: MarketRow, b: MarketRow) => number
> = {
  volume: byFixedDesc((row) => row.volume24h),
  change: byFixedDesc((row) => row.change24h),
  price: byFixedDesc((row) => row.price),
  marketCap: byFixedDesc(
    (row) => row.marketCap ?? row.reference?.price ?? null,
  ),
  name: (a, b) => a.symbol.localeCompare(b.symbol),
};

/** Pure: server-side filter, sort and paginate for the URL-driven market table. */
export function filterRows(
  rows: readonly MarketRow[],
  filters: MarketFilters,
): FilteredRows {
  const query = filters.q.toLowerCase();
  const matched = rows.filter(
    (row) =>
      (filters.issuer === "all" || row.issuer === filters.issuer) &&
      (filters.kind === "all" || row.kind === filters.kind) &&
      (!filters.priced || row.price !== null) &&
      (!query ||
        row.symbol.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query) ||
        row.underlyingSymbol.toLowerCase().includes(query)),
  );
  const sorted = [...matched].sort(
    (a, b) => SORTERS[filters.sort](a, b) || a.symbol.localeCompare(b.symbol),
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return {
    rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: sorted.length,
    page,
    pageCount,
  };
}

/** Builds a shareable /markets URL that keeps only non-default filters. */
export function filtersToSearch(
  filters: MarketFilters,
  patch: Partial<MarketFilters> = {},
): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.issuer !== "all") params.set("issuer", next.issuer);
  if (next.kind !== "all") params.set("kind", next.kind);
  if (next.sort !== "volume") params.set("sort", next.sort);
  if (next.priced) params.set("priced", "1");
  if (next.page > 1) params.set("page", String(next.page));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Case-insensitive symbol, or exact mint, as the prototype resolves /stock/[symbol]. */
export function findRow(
  rows: readonly MarketRow[],
  symbolOrMint: string,
): MarketRow | null {
  const key = symbolOrMint.trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  return (
    rows.find((row) => row.mint === key) ??
    // Prefer a verified, tradable listing when two issuers share a symbol.
    [...rows]
      .filter((row) => row.symbol.toLowerCase() === lower)
      .sort(
        (a, b) =>
          Number(b.verified) - Number(a.verified) ||
          Number(a.tradingHalted) - Number(b.tradingHalted),
      )[0] ??
    null
  );
}
