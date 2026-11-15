import { describe, expect, it } from "vitest";
import {
  COUNTRY_HEADER,
  gatedSurface,
  jurisdictionOf,
  surfaceAllowed,
} from "./jurisdiction";
import { loadPolicy } from "./policy";

const policy = loadPolicy({});
const trusted = { VERCEL: "1" };
const headers = (country?: string) =>
  new Headers(country === undefined ? {} : { [COUNTRY_HEADER]: country });

describe("jurisdictionOf: the platform country, trusted only behind the proxy", () => {
  it("allowed and restricted countries behind a trusted proxy (VERCEL=1)", () => {
    expect(jurisdictionOf(headers("DE"), trusted, policy)).toEqual({
      status: "allowed",
      country: "DE",
    });
    expect(jurisdictionOf(headers("us"), { VERCEL: "1" }, policy)).toEqual({
      status: "restricted",
      country: "US",
    });
  });

  it("an untrusted proxy ignores the header entirely (anyone can send it)", () => {
    expect(jurisdictionOf(headers("DE"), {}, policy)).toEqual({
      status: "unknown",
      country: null,
      reason: "untrusted-proxy",
    });
  });

  it.each(["", "XX1", "Deutschland", "1A"])(
    "a missing or malformed header (%j) is unknown",
    (value) => {
      expect(jurisdictionOf(headers(value), trusted, policy).status).toBe(
        "unknown",
      );
    },
  );
  it("no header at all is unknown", () => {
    expect(jurisdictionOf(headers(), trusted, policy)).toMatchObject({
      status: "unknown",
      reason: "missing",
    });
  });
});

describe("surfaceAllowed", () => {
  const allowed = { status: "allowed", country: "DE" } as const;
  const restricted = { status: "restricted", country: "US" } as const;
  const unknown = {
    status: "unknown",
    country: null,
    reason: "missing",
  } as const;

  it("trade: allowed passes; restricted and unknown are blocked (fail closed)", () => {
    expect(surfaceAllowed(allowed, "trade", policy)).toBe(true);
    expect(surfaceAllowed(restricted, "trade", policy)).toBe(false);
    expect(surfaceAllowed(unknown, "trade", policy)).toBe(false);
  });

  it("missingCountry=allow opens unknown, never restricted", () => {
    const open = loadPolicy({ OVELO_COMPLIANCE_MISSING_COUNTRY: "allow" });
    expect(surfaceAllowed(unknown, "trade", open)).toBe(true);
    expect(surfaceAllowed(restricted, "trade", open)).toBe(false);
  });

  it("browse: allowed by default for restricted visitors; blocked when the policy says so", () => {
    expect(surfaceAllowed(restricted, "browse", policy)).toBe(true);
    const closed = loadPolicy({ OVELO_COMPLIANCE_BROWSE: "block" });
    expect(surfaceAllowed(restricted, "browse", closed)).toBe(false);
    expect(surfaceAllowed(unknown, "browse", closed)).toBe(true);
  });

  it("devnet follows its own rule", () => {
    expect(surfaceAllowed(restricted, "devnet", policy)).toBe(false);
    const open = loadPolicy({ OVELO_COMPLIANCE_DEVNET: "allow" });
    expect(surfaceAllowed(restricted, "devnet", open)).toBe(true);
  });
});

describe("gatedSurface: every trading entry point", () => {
  it.each([
    ["/api/v1/trade/quote", "trade"],
    ["/api/v1/trade/submit", "trade"],
    ["/api/v1/actions/baskets/sol-core", "trade"],
    ["/api/v1/actions/baskets/8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20", "trade"],
    ["/api/v1/plans/prepare-create", "devnet"],
    ["/api/v1/faucet", "devnet"],
  ])("POST %s → %s", (path, surface) => {
    expect(gatedSurface(path, "POST")).toBe(surface);
  });

  it.each([
    "/api/v1/actions/baskets/sol-core/confirm",
    "/api/v1/plans/submit",
    "/api/v1/plans/4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz/prepare-close",
    "/api/v1/compliance/terms/accept",
    "/api/v1/creators/baskets",
  ])(
    "POST %s is not gated (receipts, exits and non-trading writes)",
    (path) => {
      expect(gatedSurface(path, "POST")).toBeNull();
    },
  );

  it("reads are never gated here (the Action GET decides its own disabled state)", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"])
      expect(
        gatedSurface("/api/v1/actions/baskets/sol-core", method),
      ).toBeNull();
  });
});
