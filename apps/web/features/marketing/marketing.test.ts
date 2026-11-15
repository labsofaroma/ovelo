import { describe, expect, it, vi } from "vitest";
import { toMarketsView } from "../markets/normalize";
import { asset, mint, snapshot } from "../test/fixtures";
import { privacyDocument } from "./content/privacy";
import { termsDocument } from "./content/terms";
import { legalDocumentSchema } from "./schema";
import { siteContact } from "./site";

const markets = vi.hoisted(() => ({ getMarkets: vi.fn() }));
vi.mock("../markets/server", () => markets);
const { getLandingSnapshot, toLandingSnapshot } = await import("./server");

describe("legal documents", () => {
  it.each([privacyDocument, termsDocument])("$title validates", (doc) => {
    expect(legalDocumentSchema.safeParse(doc).success).toBe(true);
  });
  it("rejects a document without sections or a real date", () => {
    expect(
      legalDocumentSchema.safeParse({
        ...termsDocument,
        sections: [],
        updated: "today",
      }).success,
    ).toBe(false);
  });
});

describe("siteContact (port of lib/site)", () => {
  it("accepts valid values and ignores invalid ones", () => {
    expect(
      siteContact({
        OVELO_SUPPORT_EMAIL: "help@example.test",
        OVELO_ISSUES_URL: "http://insecure",
        OVELO_OPERATOR_NAME: " Ops ",
      }),
    ).toEqual({
      operatorName: "Ops",
      supportEmail: "help@example.test",
      issuesUrl: null,
    });
    expect(siteContact({}).operatorName).toBe("the Ovelo project contributors");
  });
});

describe("landing snapshot", () => {
  it("highlights only priced, tradable, traded listings", () => {
    const view = toMarketsView(
      snapshot({
        assets: [
          asset(),
          asset({ mint: mint(5), symbol: "HALTx", tradingHalted: true }),
          asset({ mint: mint(6), symbol: "NOPx", priceUsd: null }),
        ],
      }),
    );
    expect(toLandingSnapshot(view).highlights.map((r) => r.symbol)).toEqual([
      "TESTx",
    ]);
  });
  it("propagates unavailable", async () => {
    const outage = {
      state: "unavailable",
      error: { code: "UPSTREAM_UNAVAILABLE", message: "m" },
    };
    markets.getMarkets.mockResolvedValue(outage);
    expect(await getLandingSnapshot()).toEqual(outage);
  });
});
