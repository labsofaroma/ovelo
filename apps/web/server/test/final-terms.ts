import type * as Terms from "@/features/compliance/terms";

/**
 * For tests that model a production deployment: counsel's final terms do not exist yet, so the
 * boot refuses production (server/env.terms.ts). These tests mock the registry with one extra,
 * final version selected as current:
 *
 *   vi.mock("@/features/compliance/terms", async (orig) =>
 *     (await import("@/server/test/final-terms")).withFinalTerms(await orig()));
 */
export function withFinalTerms(real: typeof Terms): typeof Terms {
  const final = {
    ...real.TERMS_VERSIONS.at(-1)!,
    version: "test-final",
    final: true,
  };
  const versions = [...real.TERMS_VERSIONS, final];
  return {
    ...real,
    TERMS_VERSIONS: versions,
    CURRENT_TERMS_VERSION: final.version,
    termsVersion: (version: string) =>
      versions.find((t) => t.version === version),
  };
}
