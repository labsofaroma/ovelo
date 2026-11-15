import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  DEFAULT_RESTRICTED_COUNTRIES,
  loadPolicy,
  PolicyError,
} from "./policy";
import { CURRENT_TERMS_VERSION } from "./terms";

describe("compliance policy (config, not code)", () => {
  it("defaults: US decided plus the counsel placeholder list, fail closed, browse-only, devnet blocked", () => {
    const policy = loadPolicy({});
    expect(policy).toEqual(DEFAULT_POLICY);
    expect(policy.restrictedCountries).toContain("US");
    for (const code of DEFAULT_RESTRICTED_COUNTRIES.placeholder)
      expect(policy.restrictedCountries).toContain(code);
    expect(policy.missingCountry).toBe("block");
    expect(policy.surfaces).toEqual({
      browse: "allow",
      trade: "block",
      devnet: "block",
    });
    expect(policy.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it("env overrides replace the list (normalised to upper case) and the rules", () => {
    const policy = loadPolicy({
      OVELO_COMPLIANCE_RESTRICTED_COUNTRIES: "us, gb ,CA",
      OVELO_COMPLIANCE_MISSING_COUNTRY: "allow",
      OVELO_COMPLIANCE_BROWSE: "block",
      OVELO_COMPLIANCE_DEVNET: "allow",
    });
    expect(policy.restrictedCountries).toEqual(["US", "GB", "CA"]);
    expect(policy.missingCountry).toBe("allow");
    expect(policy.surfaces).toEqual({
      browse: "block",
      trade: "block",
      devnet: "allow",
    });
  });

  it("blank values fall back to the defaults", () => {
    expect(loadPolicy({ OVELO_COMPLIANCE_RESTRICTED_COUNTRIES: "  " })).toEqual(
      DEFAULT_POLICY,
    );
  });

  it.each([
    ["OVELO_COMPLIANCE_RESTRICTED_COUNTRIES", "USA"],
    ["OVELO_COMPLIANCE_MISSING_COUNTRY", "maybe"],
    ["OVELO_COMPLIANCE_BROWSE", "yes"],
    ["OVELO_COMPLIANCE_DEVNET", "1"],
    ["OVELO_TERMS_VERSION", "not-a-registered-version"],
  ])("an invalid %s is refused by name, never by value", (name, value) => {
    let error: unknown;
    try {
      loadPolicy({ [name]: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PolicyError);
    expect((error as PolicyError).variables).toEqual([name]);
    expect((error as Error).message).not.toContain(value);
  });

  it("mainnet trading for restricted countries cannot be configured open", () => {
    // There is no variable for it, and the schema only accepts "block".
    expect(loadPolicy({ OVELO_COMPLIANCE_TRADE: "allow" }).surfaces.trade).toBe(
      "block",
    );
  });
});
