import { describe, expect, it } from "vitest";
import { siteUrl } from "./site";

describe("siteUrl", () => {
  it("uses AROMA_SITE_URL and keeps only its origin", () => {
    expect(siteUrl({ AROMA_SITE_URL: "https://aroma.example/" }).href).toBe(
      "https://aroma.example/",
    );
    expect(
      siteUrl({ AROMA_SITE_URL: "https://aroma.example/some/path" }).href,
    ).toBe("https://aroma.example/");
  });

  it("accepts plain http only on loopback", () => {
    expect(siteUrl({ AROMA_SITE_URL: "http://127.0.0.1:3200" }).href).toBe(
      "http://127.0.0.1:3200/",
    );
  });

  it("falls back to Vercel's production host, then to localhost", () => {
    expect(
      siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "aroma.vercel.app" }).href,
    ).toBe("https://aroma.vercel.app/");
    expect(siteUrl({}).href).toBe("http://localhost:3000/");
  });

  it("prefers AROMA_SITE_URL over the Vercel host", () => {
    expect(
      siteUrl({
        AROMA_SITE_URL: "https://aroma.example",
        VERCEL_PROJECT_PRODUCTION_URL: "aroma.vercel.app",
      }).href,
    ).toBe("https://aroma.example/");
  });

  it.each([
    "https://user:pw@aroma.example",
    "https://aroma.example/?q=1",
    "https://aroma.example/#top",
    "ftp://aroma.example",
    "http://aroma.example",
    "not a url",
  ])("refuses %s", (value) => {
    expect(() => siteUrl({ AROMA_SITE_URL: value })).toThrow();
  });
});
