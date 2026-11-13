import { describe, expect, it } from "vitest";
import { snapshot } from "../test/fixtures";
import { toMarketsView } from "./normalize";
import { marketsViewSchema, parseMarketFilters } from "./schema";

describe("parseMarketFilters (untrusted search params)", () => {
  it("defaults when empty", () => {
    expect(parseMarketFilters({})).toEqual({
      q: "",
      issuer: "all",
      kind: "all",
      sort: "volume",
      priced: false,
      page: 1,
    });
    expect(parseMarketFilters(undefined).sort).toBe("volume");
  });
  it("accepts valid values and takes the first of repeated params", () => {
    expect(
      parseMarketFilters({
        q: " apple ",
        issuer: ["prestocks", "xstocks"],
        kind: "etf",
        sort: "change",
        priced: "1",
        page: "3",
      }),
    ).toEqual({
      q: "apple",
      issuer: "prestocks",
      kind: "etf",
      sort: "change",
      priced: true,
      page: 3,
    });
  });
  it("falls back per field instead of failing on junk", () => {
    const parsed = parseMarketFilters({
      q: "<script>x</script>",
      issuer: "evil",
      sort: "DROP",
      page: "-4",
      priced: "yes",
    });
    expect(parsed.q).toBe("scriptxscript");
    expect(parsed.issuer).toBe("all");
    expect(parsed.sort).toBe("volume");
    expect(parsed.page).toBe(1);
    expect(parsed.priced).toBe(false);
  });
  it("caps the query length", () => {
    expect(parseMarketFilters({ q: "a".repeat(41) }).q).toBe("");
  });
});

describe("marketsViewSchema", () => {
  it("accepts a normalised snapshot", () => {
    expect(marketsViewSchema.safeParse(toMarketsView(snapshot())).success).toBe(
      true,
    );
  });
  it("rejects an unavailable status (never cached as data)", () => {
    const view = toMarketsView(snapshot());
    expect(
      marketsViewSchema.safeParse({ ...view, status: "unavailable" }).success,
    ).toBe(false);
  });
  it("rejects float prices: amounts must be raw integer strings", () => {
    const view = toMarketsView(snapshot());
    const row = { ...view.rows[0]!, price: { raw: "1.5", decimals: 6 } };
    expect(marketsViewSchema.safeParse({ ...view, rows: [row] }).success).toBe(
      false,
    );
  });
});
