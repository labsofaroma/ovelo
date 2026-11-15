import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "../redirects.mjs";
import config from "../next.config.mjs";

describe("next.config redirects", () => {
  it("are the legacy map plus /favicon.ico → /icon.svg, and nothing else", async () => {
    // Without SENTRY_AUTH_TOKEN (tests) the default export is the plain config object.
    const redirects = await (
      config as { redirects: () => Promise<typeof LEGACY_REDIRECTS> }
    ).redirects();
    expect(redirects).toEqual([
      ...LEGACY_REDIRECTS,
      { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
    ]);
  });
});

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
