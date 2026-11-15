import { describe, expect, it } from "vitest";
import { privacyDocument } from "./content/privacy";
import { termsDocument } from "./content/terms";
import { legalDocumentSchema } from "./schema";
import { siteContact } from "./site";

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
