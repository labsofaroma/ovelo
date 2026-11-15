import { describe, expect, it } from "vitest";
import { failed, report, staticFindings } from "./prod-env";
import { betaFindings } from "./prod-env.beta";
import { BETA_GOOD } from "./test/beta-env";

/** Phase A: `pnpm check:prod-env --profile beta` on top of the production profile. */
const beta = (env: Record<string, string>) => [
  ...staticFindings(env),
  ...betaFindings(env),
];
const statusOf = (env: Record<string, string>, name: string) =>
  beta(env)
    .filter((f) => f.name === name)
    .map((f) => f.status);

describe("beta profile", () => {
  it("a complete beta profile passes", () => {
    const findings = beta(BETA_GOOD);
    expect(failed(findings)).toBe(false);
    expect(statusOf(BETA_GOOD, "OVELO_BETA_GATE")).toEqual(["ok"]);
  });

  it("the gate must be on explicitly: unset is missing, off is forbidden", () => {
    const { OVELO_BETA_GATE: _, ...unset } = BETA_GOOD;
    expect(statusOf(unset, "OVELO_BETA_GATE")).toEqual(["missing"]);
    expect(failed(beta(unset))).toBe(true);
    expect(
      statusOf({ ...BETA_GOOD, OVELO_BETA_GATE: "off" }, "OVELO_BETA_GATE"),
    ).toContain("forbidden");
    expect(
      statusOf({ ...BETA_GOOD, OVELO_BETA_GATE: "yes" }, "OVELO_BETA_GATE"),
    ).toEqual(["invalid"]);
  });

  it.each(["OVELO_MAX_TRADE_USDC_RAW", "OVELO_MAX_DAILY_USDC_RAW"])(
    "%s unset or 0 fails",
    (name) => {
      const env: Record<string, string> = { ...BETA_GOOD };
      delete env[name];
      expect(failed(beta(env))).toBe(true);
      expect(failed(beta({ ...BETA_GOOD, [name]: "0" }))).toBe(true);
    },
  );

  it("caps above the beta values only warn", () => {
    const env = {
      ...BETA_GOOD,
      OVELO_MAX_TRADE_USDC_RAW: "100000000",
      OVELO_MAX_DAILY_USDC_RAW: "500000000",
    };
    expect(statusOf(env, "OVELO_MAX_TRADE_USDC_RAW")).toContain("warning");
    expect(failed(beta(env))).toBe(false);
  });

  it("refuses any browser-visible variable v1 does not read (prototype-only)", () => {
    const env = { ...BETA_GOOD, NEXT_PUBLIC_SOME_PROTOTYPE_ID: "x" };
    expect(statusOf(env, "NEXT_PUBLIC_SOME_PROTOTYPE_ID")).toEqual([
      "forbidden",
    ]);
    expect(failed(beta(env))).toBe(true);
    // Blank counts as unset; known public variables are fine.
    expect(
      failed(beta({ ...BETA_GOOD, NEXT_PUBLIC_SOME_PROTOTYPE_ID: " " })),
    ).toBe(false);
  });

  it("warns when the site is not a beta.<domain> host, and never prints a value", () => {
    const env = { ...BETA_GOOD, OVELO_SITE_URL: "https://ovelo.trade" };
    expect(statusOf(env, "OVELO_SITE_URL")).toContain("warning");
    const text = report(beta(env));
    for (const value of Object.values(BETA_GOOD))
      if (value.length > 6) expect(text).not.toContain(value);
  });
});
