import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";
import { expectedOrigin } from "./http";

/**
 * The origin a creator challenge is bound to. Cross-site refusal itself is middleware's job
 * (server/middleware.test.ts, "creator routes"); handlers no longer check Origin (M5b A2).
 */
const request = (
  headers: Record<string, string> = {},
  url = "http://localhost:3000/api/v1/creators/challenge",
) => new Request(url, { method: "POST", headers });

function env(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("expectedOrigin", () => {
  it("binds to AROMA_SITE_URL when it is set", () => {
    env({ AROMA_SITE_URL: "https://aroma.example" });
    expect(expectedOrigin(request({ host: "other.example" }))).toBe(
      "https://aroma.example",
    );
  });

  it("uses the client's Host, not request.url (next start rewrites it to localhost)", () => {
    env({ AROMA_SITE_URL: "", VERCEL: "", AROMA_TRUST_PROXY: "false" });
    expect(expectedOrigin(request({ host: "aroma.lan:3000" }))).toBe(
      "http://aroma.lan:3000",
    );
    expect(expectedOrigin(request())).toBe("http://localhost:3000");
  });

  it("trusts x-forwarded-proto and x-forwarded-host only behind a trusted proxy", () => {
    env({ AROMA_SITE_URL: "", VERCEL: "", AROMA_TRUST_PROXY: "false" });
    const forwarded = request({
      host: "internal:3000",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "aroma.example",
    });
    expect(expectedOrigin(forwarded)).toBe("http://internal:3000");
    env({ VERCEL: "1" });
    expect(expectedOrigin(forwarded)).toBe("https://aroma.example");
  });
});
