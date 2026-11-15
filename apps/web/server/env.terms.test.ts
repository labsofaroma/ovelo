import { describe, expect, it } from "vitest";
import { BASE_ENV } from "./test/base-env";
import { parseEnv } from "./env.schema";

/** The real registry: counsel's final terms are not in yet, so production must refuse. */
const SELF = {
  OVELO_PLATFORM: "selfhost",
  OVELO_PROXY_MODE: "cloudflare",
  OVELO_ORIGIN_SECRET: "test-origin-secret-0123456789abcdefABCDEF",
  NODE_ENV: "production",
};
const problems = (env: Record<string, string>) => {
  const result = parseEnv({ ...BASE_ENV, ...env });
  return result.ok ? [] : result.error.issues.map((i) => i.variable);
};

describe("launch gate: counsel's final terms (server/env.terms.ts)", () => {
  it("refuses production on the placeholder terms, with or without the beta switch", () => {
    expect(problems({ ...SELF, OVELO_DEPLOY_ENV: "production" })).toContain(
      "OVELO_TERMS_VERSION",
    );
    const withSwitch = problems({
      ...SELF,
      OVELO_DEPLOY_ENV: "production",
      OVELO_ALLOW_PLACEHOLDER_TERMS: "true",
    });
    expect(withSwitch).toContain("OVELO_ALLOW_PLACEHOLDER_TERMS");
    expect(withSwitch).toContain("OVELO_TERMS_VERSION");
  });

  it("lets a beta run on the placeholder only when the owner says so", () => {
    expect(problems({ ...SELF, OVELO_DEPLOY_ENV: "beta" })).toContain(
      "OVELO_TERMS_VERSION",
    );
    const beta = problems({
      ...SELF,
      OVELO_DEPLOY_ENV: "beta",
      OVELO_ALLOW_PLACEHOLDER_TERMS: "true",
    });
    expect(beta).not.toContain("OVELO_TERMS_VERSION");
    expect(beta).not.toContain("OVELO_ALLOW_PLACEHOLDER_TERMS");
  });

  it("does not apply outside the production rules or during next build", () => {
    expect(problems({})).not.toContain("OVELO_TERMS_VERSION");
    expect(
      problems({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    ).not.toContain("OVELO_TERMS_VERSION");
  });
});
