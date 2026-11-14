import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env.schema";
import { betaConfig, betaGateOn } from "./config";
import { betaEntry, normalizePath } from "./paths";

const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";

describe("beta gate config (W2)", () => {
  it("is ON by default in production and must be switched off explicitly", () => {
    expect(betaGateOn({ NODE_ENV: "production" })).toBe(true);
    expect(betaGateOn({ VERCEL_ENV: "production" })).toBe(true);
    expect(betaGateOn({ NODE_ENV: "production", AROMA_BETA_GATE: "off" })).toBe(
      false,
    );
    expect(betaGateOn({ NODE_ENV: "development" })).toBe(false);
    expect(betaGateOn({ NODE_ENV: "test", AROMA_BETA_GATE: "on" })).toBe(true);
  });

  it("an unreadable value fails closed", () => {
    expect(
      betaGateOn({ NODE_ENV: "development", AROMA_BETA_GATE: "Off" }),
    ).toBe(true);
    expect(betaGateOn({ AROMA_BETA_GATE: "false" })).toBe(true);
    expect(parseEnv({ AROMA_BETA_GATE: "false" }).ok).toBe(false);
  });

  it("validates the wallet allowlist at boot and grants nothing when malformed", () => {
    expect(parseEnv({ AROMA_BETA_WALLETS: `${WALLET}, ${WALLET}` }).ok).toBe(
      true,
    );
    expect(parseEnv({ AROMA_BETA_WALLETS: `${WALLET},not-a-wallet` }).ok).toBe(
      false,
    );
    expect(
      betaConfig({ AROMA_BETA_GATE: "on", AROMA_BETA_WALLETS: `${WALLET},x` })
        .wallets.size,
    ).toBe(0);
    expect(
      betaConfig({
        AROMA_BETA_GATE: "on",
        AROMA_BETA_WALLETS: ` ${WALLET} `,
      }).wallets.has(WALLET),
    ).toBe(true);
  });
});

const GATED = [
  ["/api/v1/trade/quote", "quote"],
  ["/api/v1/trade/submit", "submit"],
  ["/api/v1/actions/baskets/sol-core", "action"],
  ["/api/v1/actions/baskets/8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20", "action"],
  ["/api/trade/execute", "prototype"],
  ["/api/actions/buy-baskets/x", "prototype"],
  ["/api/transaction/execute", "prototype"],
  ["/api/bundles/execute", "prototype"],
  ["/api/buy-basket", "prototype"],
] as const;

describe("gated entry points", () => {
  it.each(GATED)(
    "%s is gated as %s for POST, never for reads",
    (path, entry) => {
      expect(betaEntry(path, "POST")).toBe(entry);
      expect(betaEntry(path, "put")).toBe(entry);
      for (const method of ["GET", "HEAD", "OPTIONS"])
        expect(betaEntry(path, method)).toBeNull();
    },
  );

  it.each([
    "/api/v1/actions/baskets/sol-core/confirm",
    "/api/v1/compliance/terms/accept",
    "/api/v1/beta/redeem",
    "/api/v1/plans/prepare-create",
    "/api/v1/faucet",
    "/api/v1/prices",
    "/v1/markets",
  ])("%s stays open (receipts, terms, redeem, devnet, reads)", (path) => {
    expect(betaEntry(path, "POST")).toBeNull();
  });

  /** A spelling of `path` that a URL parser or router may treat as the same resource. */
  const variant = (path: string) =>
    fc
      .record({
        slashes: fc.array(fc.integer({ min: 1, max: 3 }), {
          minLength: 8,
          maxLength: 8,
        }),
        trailing: fc.constantFrom("", "/", "//"),
        dot: fc.boolean(),
        encode: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        upper: fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        twice: fc.boolean(),
      })
      .map(({ slashes, trailing, dot, encode, upper, twice }) => {
        const segments = path.split("/").filter(Boolean);
        let out = "";
        segments.forEach((segment, i) => {
          out += "/".repeat(slashes[i % slashes.length]!);
          if (dot && i === 1) out += "./";
          if (dot && i === 2) out += `x/../`;
          out += [...segment]
            .map((char, j) => {
              const c = upper[j % 64] ? char.toUpperCase() : char;
              if (!encode[j % 64]) return c;
              const hex = `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
              return twice ? hex.replace("%", "%25") : hex;
            })
            .join("");
        });
        return out + trailing;
      });

  it("no path variant of a gated entry point escapes the gate (property)", () => {
    for (const [path, entry] of GATED)
      fc.assert(
        fc.property(
          variant(path),
          fc.constantFrom("POST", "post", "PUT", "DELETE", "PATCH"),
          (p, method) => {
            expect(normalizePath(p)).toBe(path.toLowerCase());
            expect(betaEntry(p, method)).toBe(entry);
          },
        ),
        { numRuns: 300 },
      );
  });
});
