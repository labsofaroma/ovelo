import { describe, expect, it } from "vitest";
import { siteUrl } from "./site";

describe("siteUrl", () => {
  it("uses OVELO_SITE_URL and keeps only its origin", () => {
    expect(siteUrl({ OVELO_SITE_URL: "https://ovelo.example/" }).href).toBe(
      "https://ovelo.example/",
    );
    expect(
      siteUrl({ OVELO_SITE_URL: "https://ovelo.example/some/path" }).href,
    ).toBe("https://ovelo.example/");
  });

  it("accepts plain http only on loopback", () => {
    expect(siteUrl({ OVELO_SITE_URL: "http://127.0.0.1:3200" }).href).toBe(
      "http://127.0.0.1:3200/",
    );
  });

  it("falls back to Vercel's production host, then to localhost", () => {
    expect(
      siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "ovelo.vercel.app" }).href,
    ).toBe("https://ovelo.vercel.app/");
    expect(siteUrl({}).href).toBe("http://localhost:3000/");
  });

  it("prefers OVELO_SITE_URL over the Vercel host", () => {
    expect(
      siteUrl({
        OVELO_SITE_URL: "https://ovelo.example",
        VERCEL_PROJECT_PRODUCTION_URL: "ovelo.vercel.app",
      }).href,
    ).toBe("https://ovelo.example/");
  });

  it.each([
    "https://user:pw@ovelo.example",
    "https://ovelo.example/?q=1",
    "https://ovelo.example/#top",
    "ftp://ovelo.example",
    "http://ovelo.example",
    "not a url",
  ])("refuses %s", (value) => {
    expect(() => siteUrl({ OVELO_SITE_URL: value })).toThrow();
  });
});
