import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";
import { AppError } from "@/server/errors";
import { assertSameOrigin, expectedOrigin } from "./http";

const request = (headers: Record<string, string> = {}) =>
  new Request("http://internal.host:3000/api/v1/creators/challenge", {
    method: "POST",
    headers,
  });

function env(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("origin rules", () => {
  it("binds to AROMA_SITE_URL when it is set", () => {
    env({ AROMA_SITE_URL: "https://aroma.example" });
    expect(expectedOrigin(request())).toBe("https://aroma.example");
  });

  it("uses x-forwarded-proto only behind a trusted proxy", () => {
    env({ AROMA_SITE_URL: "", VERCEL: "" });
    const forwarded = request({ "x-forwarded-proto": "https" });
    expect(expectedOrigin(forwarded)).toBe("http://internal.host:3000");
    env({ VERCEL: "1" });
    expect(expectedOrigin(forwarded)).toBe("https://internal.host:3000");
  });

  it("accepts the site, AROMA_ALLOWED_ORIGINS and no Origin; refuses others", () => {
    env({
      AROMA_SITE_URL: "https://aroma.example",
      AROMA_ALLOWED_ORIGINS:
        "https://preview.aroma.example, https://next.aroma.example",
    });
    for (const origin of [
      "https://aroma.example",
      "https://preview.aroma.example",
      "https://next.aroma.example",
    ])
      expect(() => assertSameOrigin(request({ origin }))).not.toThrow();
    expect(() => assertSameOrigin(request())).not.toThrow();
    expect(() =>
      assertSameOrigin(request({ origin: "https://evil.example" })),
    ).toThrow(AppError);
    expect(() =>
      assertSameOrigin(request({ "sec-fetch-site": "cross-site" })),
    ).toThrow(AppError);
  });
});
