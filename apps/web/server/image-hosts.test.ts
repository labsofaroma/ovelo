import { describe, expect, it } from "vitest";
import config from "../next.config.mjs";
import { IMAGE_HOSTS, isAllowedImageUrl } from "../image-hosts.mjs";
import { buildCsp } from "./csp";

describe("image hosts: one list for next/image, the CSP and the avatar adapter", () => {
  it("next.config remotePatterns are exactly IMAGE_HOSTS over https", () => {
    // Without SENTRY_AUTH_TOKEN (tests) the default export is the plain config object.
    const patterns = ((config as { images?: { remotePatterns?: unknown[] } })
      .images?.remotePatterns ?? []) as {
      protocol?: string;
      hostname: string;
    }[];
    expect(patterns.map((p) => p.hostname)).toEqual([...IMAGE_HOSTS]);
    expect(patterns.every((p) => p.protocol === "https")).toBe(true);
  });

  it("the CSP img-src lists every host and no wildcard", () => {
    const policy = buildCsp({
      nonce: "n",
      env: {},
      development: false,
    });
    const img = policy.split("; ").find((d) => d.startsWith("img-src "))!;
    for (const host of IMAGE_HOSTS) expect(img).toContain(`https://${host}`);
    expect(img).not.toMatch(/\shttps:(\s|$)|\*/);
  });

  it("includes Jupiter's icon CDN (it served the logo that crashed /markets)", () => {
    expect(IMAGE_HOSTS).toContain("static.datapi.jup.ag");
  });

  it("allows only https URLs on a listed host", () => {
    expect(
      isAllowedImageUrl("https://static.datapi.jup.ag/token-icons/a.webp"),
    ).toBe(true);
    expect(isAllowedImageUrl("http://static.datapi.jup.ag/a.webp")).toBe(false);
    expect(isAllowedImageUrl("https://evil.example/a.webp")).toBe(false);
    expect(
      isAllowedImageUrl("https://static.datapi.jup.ag.evil.example/a.webp"),
    ).toBe(false);
    expect(isAllowedImageUrl("not a url")).toBe(false);
    expect(isAllowedImageUrl("/company-logos/aapl.webp")).toBe(false);
  });
});
