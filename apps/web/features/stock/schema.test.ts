import { describe, expect, it } from "vitest";
import { mint, research } from "../test/fixtures";
import { toResearchView } from "./normalize";
import { researchViewSchema, symbolParamSchema } from "./schema";

describe("symbolParamSchema", () => {
  it("accepts symbols and mints, URL-decoded", () => {
    expect(symbolParamSchema.parse("AAPLx")).toBe("AAPLx");
    expect(symbolParamSchema.parse("BRK.B")).toBe("BRK.B");
    expect(symbolParamSchema.parse(mint(1))).toBe(mint(1));
  });
  it("rejects anything else", () => {
    for (const bad of ["", "a b", "<x>", "x".repeat(25), "%ZZ"])
      expect(symbolParamSchema.safeParse(bad).success).toBe(false);
  });
});

describe("toResearchView", () => {
  it("converts figures to Fixed and validates", () => {
    const view = toResearchView(research());
    expect(researchViewSchema.safeParse(view).success).toBe(true);
    expect(view.closes[1]?.close).toEqual({ raw: "1025000", decimals: 4 });
    expect(view.technicals?.rsi14).toEqual({ raw: "5550", decimals: 2 });
    expect(view.fundamentals[0]?.value).toEqual({
      raw: "123456789000",
      decimals: 2,
    });
  });
  it("drops non-https links item by item", () => {
    const view = toResearchView(
      research({
        sources: [
          { name: "ok", url: "https://example.test" },
          { name: "bad", url: "http://insecure.test" },
        ],
      }),
    );
    expect(view.sources.map((s) => s.name)).toEqual(["ok"]);
  });
  it("drops a profile without an https source (no unsourced facts)", () => {
    const base = research();
    const view = toResearchView({
      ...base,
      profile: { ...base.profile!, sourceUrl: "ftp://x" },
    });
    expect(view.profile).toBeNull();
  });
  it("throws on unavailable research so it is never cached", () => {
    expect(() => toResearchView(research({ status: "unavailable" }))).toThrow();
  });
});
