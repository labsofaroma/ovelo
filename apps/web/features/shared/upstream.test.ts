import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_ENV } from "@/server/test/base-env";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/server/logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn() },
}));

const { upstreamOutageSimulated, resetOutageWarningForTests } =
  await import("./upstream");
const { parseEnv, testSwitchesAllowed } = await import("@/server/env.schema");

describe("A2: OVELO_V1_SIMULATE_UPSTREAM_OUTAGE is inert in production", () => {
  beforeEach(() => {
    warn.mockReset();
    resetOutageWarningForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off when the switch is unset", () => {
    vi.stubEnv("OVELO_V1_SIMULATE_UPSTREAM_OUTAGE", "");
    expect(upstreamOutageSimulated()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("works in development and test, and warns", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OVELO_V1_SIMULATE_UPSTREAM_OUTAGE", "true");
    expect(upstreamOutageSimulated()).toBe(true);
    expect(upstreamOutageSimulated()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/is on/);
  });

  it("has no effect under NODE_ENV=production without the opt-in, and warns", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OVELO_V1_SIMULATE_UPSTREAM_OUTAGE", "true");
    vi.stubEnv("OVELO_V1_ALLOW_TEST_SWITCHES", "");
    expect(upstreamOutageSimulated()).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ignored/);
  });

  it("works for a local `next start` that opts in (the Playwright outage server)", () => {
    // Phase H: a local `next start` declares itself (server/platform.ts).
    vi.stubEnv("OVELO_PLATFORM", "selfhost");
    vi.stubEnv("OVELO_DEPLOY_ENV", "development");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OVELO_V1_SIMULATE_UPSTREAM_OUTAGE", "true");
    vi.stubEnv("OVELO_V1_ALLOW_TEST_SWITCHES", "true");
    expect(upstreamOutageSimulated()).toBe(true);
  });

  it("never works on a Vercel production deployment, even opted in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("OVELO_V1_SIMULATE_UPSTREAM_OUTAGE", "true");
    vi.stubEnv("OVELO_V1_ALLOW_TEST_SWITCHES", "true");
    expect(upstreamOutageSimulated()).toBe(false);
  });
});

describe("testSwitchesAllowed and the env schema", () => {
  it("decides from NODE_ENV, VERCEL_ENV and the opt-in", () => {
    expect(testSwitchesAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(testSwitchesAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(
      testSwitchesAllowed({
        // Phase H: a local `next start` declares itself (server/platform.ts).
        OVELO_PLATFORM: "selfhost",
        OVELO_DEPLOY_ENV: "development",
        NODE_ENV: "production",
        OVELO_V1_ALLOW_TEST_SWITCHES: "true",
      }),
    ).toBe(true);
    // Phase H: without a platform answer, production refuses them (fail closed).
    expect(
      testSwitchesAllowed({
        NODE_ENV: "production",
        OVELO_V1_ALLOW_TEST_SWITCHES: "true",
      }),
    ).toBe(false);
    expect(
      testSwitchesAllowed({
        NODE_ENV: "development",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
  });

  it("rejects OVELO_V1_ALLOW_TEST_SWITCHES on a Vercel production deployment", () => {
    const result = parseEnv({
      ...BASE_ENV,
      VERCEL_ENV: "production",
      OVELO_V1_ALLOW_TEST_SWITCHES: "true",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((i) => i.variable)).toContain(
        "OVELO_V1_ALLOW_TEST_SWITCHES",
      );
    }
    expect(
      parseEnv({
        ...BASE_ENV,
        VERCEL_ENV: "preview",
        OVELO_V1_ALLOW_TEST_SWITCHES: "true",
      }).ok,
    ).toBe(true);
  });
});
