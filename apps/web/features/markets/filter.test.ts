import { describe, expect, it } from "vitest";
import { asset, mint, snapshot } from "../test/fixtures";
import { filterRows, filtersToSearch, findRow } from "./filter";
import { toMarketRow, toMarketsView } from "./normalize";
import { PAGE_SIZE, parseMarketFilters } from "./schema";

const rows = toMarketsView(snapshot()).rows;

describe("filterRows", () => {
  it("sorts by volume with missing values last", () => {
    const out = filterRows(rows, parseMarketFilters({}));
    expect(out.rows.map((r) => r.symbol)).toEqual(["TESTx", "DOWNx", "NOPx"]);
  });
  it("sorts by change descending", () => {
    const out = filterRows(rows, parseMarketFilters({ sort: "change" }));
    expect(out.rows.map((r) => r.symbol)).toEqual(["TESTx", "DOWNx", "NOPx"]);
  });
  it("filters by query, issuer and priced", () => {
    expect(filterRows(rows, parseMarketFilters({ q: "down" })).total).toBe(1);
    expect(
      filterRows(rows, parseMarketFilters({ issuer: "prestocks" })).total,
    ).toBe(0);
    expect(filterRows(rows, parseMarketFilters({ priced: "1" })).total).toBe(2);
  });
  it("paginates and clamps an out-of-range page", () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) =>
      toMarketRow(asset({ mint: mint(100 + i), symbol: `S${i}x` })),
    );
    const last = filterRows(many, parseMarketFilters({ page: "9" }));
    expect(last.page).toBe(2);
    expect(last.pageCount).toBe(2);
    expect(last.rows).toHaveLength(5);
  });
});

describe("filtersToSearch", () => {
  it("keeps only non-default params so URLs stay short and shareable", () => {
    const filters = parseMarketFilters({ q: "app", sort: "volume" });
    expect(filtersToSearch(filters)).toBe("?q=app");
    expect(filtersToSearch(filters, { page: 2 })).toBe("?q=app&page=2");
    expect(filtersToSearch(parseMarketFilters({}))).toBe("");
  });
});

describe("findRow", () => {
  it("matches a symbol case-insensitively or an exact mint", () => {
    expect(findRow(rows, "testx")?.mint).toBe(mint(1));
    expect(findRow(rows, mint(2))?.symbol).toBe("DOWNx");
    expect(findRow(rows, "nothing")).toBeNull();
    expect(findRow(rows, "  ")).toBeNull();
  });
  it("prefers a verified, tradable listing when symbols collide", () => {
    const dupes = [
      toMarketRow(asset({ mint: mint(7), verified: false })),
      toMarketRow(asset({ mint: mint(8), verified: true })),
    ];
    expect(findRow(dupes, "TESTx")?.mint).toBe(mint(8));
  });
});
