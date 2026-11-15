import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { jurisdictionOf } from "@/features/compliance/jurisdiction";
import { loadPolicy } from "@/features/compliance/policy";
import {
  clientCountry,
  clientIp,
  proxyMode,
  proxyProblems,
  requestHost,
  requestProtocol,
  UNKNOWN_IP,
} from "./proxy";
import { parseEnv } from "./env.schema";
import { BASE_ENV } from "./test/base-env";

vi.mock("@/features/compliance/terms", async (orig) =>
  (await import("@/server/test/final-terms")).withFinalTerms(await orig()),
);

const SECRET = "test-origin-secret-0123456789abcdefABCDEF";
const VERCEL = { VERCEL: "1", VERCEL_ENV: "production" };
const CLOUDFLARE = {
  AROMA_PLATFORM: "selfhost",
  AROMA_DEPLOY_ENV: "production",
  AROMA_PROXY_MODE: "cloudflare",
  AROMA_ORIGIN_SECRET: SECRET,
};
const NONE = { AROMA_PLATFORM: "selfhost", AROMA_DEPLOY_ENV: "development" };

/** Every client-controllable header an attacker could forge at once. */
const FORGED = {
  "x-forwarded-for": "6.6.6.6, 7.7.7.7",
  "x-real-ip": "6.6.6.6",
  "true-client-ip": "6.6.6.6",
  "x-forwarded-host": "evil.example",
  "x-forwarded-proto": "https",
};
const h = (headers: Record<string, string>) => new Headers(headers);
const policy = loadPolicy({});

describe("AROMA_PROXY_MODE resolution", () => {
  it.each([
    ["Vercel, unset → vercel", VERCEL, "vercel", []],
    [
      "Vercel, explicit vercel",
      { ...VERCEL, AROMA_PROXY_MODE: "vercel" },
      "vercel",
      [],
    ],
    ["self-host, unset, development → none", NONE, "none", []],
    ["self-host cloudflare with a secret", CLOUDFLARE, "cloudflare", []],
    [
      "self-host production without cloudflare (refused)",
      { ...CLOUDFLARE, AROMA_PROXY_MODE: "none" },
      "none",
      ["AROMA_PROXY_MODE"],
    ],
    [
      "self-host beta, unset (refused)",
      { ...NONE, AROMA_DEPLOY_ENV: "beta" },
      "none",
      ["AROMA_PROXY_MODE"],
    ],
    [
      "vercel mode off Vercel (refused, trusts nothing)",
      { ...NONE, AROMA_PROXY_MODE: "vercel" },
      "none",
      ["AROMA_PROXY_MODE"],
    ],
    [
      "cloudflare mode on Vercel (refused, trusts nothing)",
      {
        ...VERCEL,
        AROMA_PROXY_MODE: "cloudflare",
        AROMA_ORIGIN_SECRET: SECRET,
      },
      "none",
      ["AROMA_PROXY_MODE"],
    ],
    [
      "cloudflare without a secret (refused)",
      { ...CLOUDFLARE, AROMA_ORIGIN_SECRET: "" },
      "cloudflare",
      ["AROMA_ORIGIN_SECRET"],
    ],
    [
      "cloudflare with a short secret (refused)",
      { ...CLOUDFLARE, AROMA_ORIGIN_SECRET: "short" },
      "cloudflare",
      ["AROMA_ORIGIN_SECRET"],
    ],
    [
      "origin secret equal to the trade secret (refused)",
      { ...CLOUDFLARE, AROMA_TRADE_SECRET: SECRET },
      "cloudflare",
      ["AROMA_ORIGIN_SECRET"],
    ],
    [
      "unknown mode (refused, trusts nothing)",
      { ...NONE, AROMA_PROXY_MODE: "nginx" },
      "none",
      ["AROMA_PROXY_MODE"],
    ],
    [
      "the removed AROMA_TRUST_PROXY=true (refused by name)",
      { ...VERCEL, AROMA_TRUST_PROXY: "true" },
      "vercel",
      ["AROMA_TRUST_PROXY"],
    ],
    [
      "the removed AROMA_TRUST_PROXY=false (refused by name, never silently kept)",
      { ...NONE, AROMA_TRUST_PROXY: "false" },
      "none",
      ["AROMA_TRUST_PROXY"],
    ],
  ] as const)("%s", (_name, env, mode, refused) => {
    expect(proxyMode(env)).toBe(mode);
    expect(proxyProblems(env).map((p) => p.variable)).toEqual(refused);
  });

  it("the boot schema refuses the same answers, by name and without the value", () => {
    const result = parseEnv({
      ...BASE_ENV,
      ...NONE,
      AROMA_DEPLOY_ENV: "beta",
      NODE_ENV: "production",
      AROMA_TRUST_PROXY: "true",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((i) => i.variable)).toEqual(
        expect.arrayContaining(["AROMA_TRUST_PROXY", "AROMA_PROXY_MODE"]),
      );
      expect(result.error.message).toMatch(/replaced by AROMA_PROXY_MODE/);
    }
    expect(
      parseEnv({ ...BASE_ENV, ...CLOUDFLARE, NODE_ENV: "production" }).ok,
    ).toBe(true);
    const leaked = parseEnv({
      ...BASE_ENV,
      ...CLOUDFLARE,
      AROMA_ORIGIN_SECRET: "too-short-secret",
    });
    expect(leaked.ok).toBe(false);
    if (!leaked.ok)
      expect(leaked.error.message).not.toContain("too-short-secret");
  });
});

describe("spoofing: each mode ignores the headers it does not trust", () => {
  it("cloudflare: the IP is CF-Connecting-IP only; forged forwarding headers are ignored", () => {
    expect(
      clientIp(h({ ...FORGED, "cf-connecting-ip": "203.0.113.5" }), CLOUDFLARE),
    ).toBe("203.0.113.5");
    expect(
      clientIp(h({ ...FORGED, "cf-connecting-ip": "2001:db8::1" }), CLOUDFLARE),
    ).toBe("2001:db8::1");
    // Without Cloudflare's header there is no IP, never the forged one.
    expect(clientIp(h(FORGED), CLOUDFLARE)).toBe("unknown");
    expect(
      clientIp(h({ "cf-connecting-ip": "not an ip; drop" }), CLOUDFLARE),
    ).toBe("unknown");
  });

  it("cloudflare: the country is CF-IPCountry only; a forged x-vercel-ip-country is ignored", () => {
    const forged = h({ "x-vercel-ip-country": "DE" });
    expect(jurisdictionOf(forged, CLOUDFLARE, policy)).toMatchObject({
      status: "unknown",
      reason: "missing",
    });
    expect(
      jurisdictionOf(
        h({ "x-vercel-ip-country": "DE", "cf-ipcountry": "US" }),
        CLOUDFLARE,
        policy,
      ),
    ).toEqual({ status: "restricted", country: "US" });
    expect(
      jurisdictionOf(h({ "cf-ipcountry": "de" }), CLOUDFLARE, policy),
    ).toEqual({
      status: "allowed",
      country: "DE",
    });
  });

  it("cloudflare: XX (no data) and T1 (Tor) are unknown, so trading fails closed", () => {
    expect(clientCountry(h({ "cf-ipcountry": "XX" }), CLOUDFLARE)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(clientCountry(h({ "cf-ipcountry": "T1" }), CLOUDFLARE)).toEqual({
      ok: false,
      reason: "anonymous",
    });
    expect(
      jurisdictionOf(h({ "cf-ipcountry": "T1" }), CLOUDFLARE, policy),
    ).toMatchObject({
      status: "unknown",
      reason: "anonymous",
    });
  });

  it("cloudflare: the host is Host, never a forged X-Forwarded-Host; the scheme is Cloudflare's", () => {
    const headers = h({ ...FORGED, host: "beta.aroma.example" });
    expect(requestHost(headers, "fallback", CLOUDFLARE)).toBe(
      "beta.aroma.example",
    );
    expect(requestProtocol(headers, "http:", CLOUDFLARE)).toBe("https");
  });

  it("cloudflare: CF-Visitor is the scheme fallback (no redirect loop); never in vercel or none mode", () => {
    const visitor = h({ "cf-visitor": '{"scheme":"https"}' });
    expect(requestProtocol(visitor, "http:", CLOUDFLARE)).toBe("https");
    expect(
      requestProtocol(h({ "cf-visitor": "not json" }), "http:", CLOUDFLARE),
    ).toBe("http");
    expect(
      requestProtocol(
        h({ "cf-visitor": '{"scheme":"gopher"}' }),
        "http:",
        CLOUDFLARE,
      ),
    ).toBe("http");
    expect(requestProtocol(visitor, "http:", VERCEL)).toBe("http");
    expect(requestProtocol(visitor, "http:", NONE)).toBe("http");
  });

  it("vercel: a forged CF-IPCountry and CF-Connecting-IP are ignored (Vercel's headers win)", () => {
    const headers = h({
      "cf-ipcountry": "DE",
      "cf-connecting-ip": "6.6.6.6",
      "x-real-ip": "203.0.113.9",
      "x-vercel-ip-country": "US",
    });
    expect(clientIp(headers, VERCEL)).toBe("203.0.113.9");
    expect(jurisdictionOf(headers, VERCEL, policy)).toEqual({
      status: "restricted",
      country: "US",
    });
    expect(
      jurisdictionOf(h({ "cf-ipcountry": "DE" }), VERCEL, policy),
    ).toMatchObject({ status: "unknown", reason: "missing" });
  });

  it("none: no header is trusted at all", () => {
    const all = h({
      ...FORGED,
      "cf-connecting-ip": "6.6.6.6",
      "cf-ipcountry": "DE",
      "x-vercel-ip-country": "DE",
      host: "localhost:3000",
    });
    expect(clientIp(all, NONE)).toBe(UNKNOWN_IP);
    expect(jurisdictionOf(all, NONE, policy)).toMatchObject({
      status: "unknown",
      reason: "untrusted-proxy",
    });
    expect(requestHost(all, "x", NONE)).toBe("localhost:3000");
    expect(requestProtocol(all, "http:", NONE)).toBe("http");
  });

  it("an inconsistent configuration trusts nothing (fail closed)", () => {
    const bad = { ...NONE, AROMA_PROXY_MODE: "vercel" };
    expect(clientIp(h({ "x-real-ip": "6.6.6.6" }), bad)).toBe(UNKNOWN_IP);
    expect(
      jurisdictionOf(h({ "x-vercel-ip-country": "DE" }), bad, policy).status,
    ).toBe("unknown");
  });
});

describe("one header parser", () => {
  it("no source file outside server/proxy.ts names a forwarding or geo header", () => {
    const root = join(import.meta.dirname, "..");
    const files = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        "*.ts",
        "*.tsx",
        "*.mjs",
      ],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter(
        (f) =>
          f !== "server/proxy.ts" &&
          // Names them only to REDACT them from logs (never reads a request header).
          f !== "observability/scrub.ts" &&
          !/\.test\.tsx?$/.test(f) &&
          // E2E specs and fixtures SEND these headers as a client would (an edge stand-in).
          !f.startsWith("e2e/"),
      );
    // String literals only: doc comments may name a header in backticks.
    const NAMES =
      /["'](x-forwarded-for|x-forwarded-host|x-forwarded-proto|x-real-ip|true-client-ip|cf-connecting-ip|cf-ipcountry|x-vercel-ip-country)["']/i;
    const offenders = files.filter((f) =>
      NAMES.test(readFileSync(join(root, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
