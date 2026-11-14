import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "../redirects.mjs";

/** M9 Step 4: the URL map (docs/launch/CUTOVER-MAP.md §4), all 308 (permanent). */
describe("legacy redirects", () => {
  it("map every moved URL, and only those", () => {
    expect(
      LEGACY_REDIRECTS.map(({ source, destination }) => [source, destination]),
    ).toEqual([
      ["/v1", "/"],
      ["/v1/:path*", "/:path*"],
      ["/landing", "/"],
      ["/app", "/markets"],
      ["/sip", "/invest"],
      ["/basket/builder", "/basket/new"],
      ["/orders", "/portfolio#activity"],
    ]);
  });

  it("are permanent (308 keeps the method and the query)", () => {
    for (const redirect of LEGACY_REDIRECTS)
      expect(redirect.permanent).toBe(true);
  });

  it("never touch the versioned API or the Actions file", () => {
    for (const { source } of LEGACY_REDIRECTS) {
      expect(source.startsWith("/api")).toBe(false);
      expect(source).not.toBe("/actions.json");
    }
  });
});
