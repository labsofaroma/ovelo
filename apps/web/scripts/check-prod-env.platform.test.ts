import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { failed, platformFindings, staticFindings } from "../server/prod-env";
import { betaFindings } from "../server/prod-env.beta";
import { BETA_GOOD } from "../server/test/beta-env";

/** Phase H Step 1: `check:prod-env --platform selfhost` validates the self-host variables. */
const SELF_BETA = {
  ...BETA_GOOD,
  AROMA_PLATFORM: "selfhost",
  AROMA_DEPLOY_ENV: "beta",
  // Step 2: self-host production and beta run behind Cloudflare with the origin lock.
  AROMA_PROXY_MODE: "cloudflare",
  AROMA_ORIGIN_SECRET: "test-origin-secret-0123456789abcdefABCDEF",
};

const findings = (
  env: Record<string, string>,
  platform: "vercel" | "selfhost",
  profile: "production" | "beta" = "beta",
) => [
  ...staticFindings(env, platform),
  ...platformFindings(env, platform, profile),
  ...betaFindings(env),
];
const status = (all: ReturnType<typeof findings>, name: string) =>
  all.filter((f) => f.name === name).map((f) => f.status);

describe("check:prod-env --platform", () => {
  it("vercel (the default) is unchanged: the beta file passes without the self-host variables", () => {
    expect(failed(findings(BETA_GOOD, "vercel"))).toBe(false);
  });

  it("selfhost passes a complete beta file that declares selfhost and beta", () => {
    const all = findings(SELF_BETA, "selfhost");
    expect(failed(all)).toBe(false);
    expect(status(all, "AROMA_PLATFORM")).toEqual(["ok"]);
    expect(status(all, "AROMA_DEPLOY_ENV")).toEqual(["ok"]);
  });

  it("selfhost refuses a file without AROMA_PLATFORM or AROMA_DEPLOY_ENV", () => {
    // The Vercel beta file declares AROMA_DEPLOY_ENV=beta; a self-host file must declare both.
    const { AROMA_DEPLOY_ENV: _declared, ...undeclared } = BETA_GOOD;
    const all = findings(undeclared, "selfhost");
    expect(failed(all)).toBe(true);
    expect(status(all, "AROMA_PLATFORM")).toContain("missing");
    expect(status(all, "AROMA_DEPLOY_ENV")).toContain("missing");
  });

  it("selfhost passes a file without NEXT_PUBLIC_* (build values, baked into the image) with a warning", () => {
    const fileOnly = Object.fromEntries(
      Object.entries(SELF_BETA).filter(([k]) => !k.startsWith("NEXT_PUBLIC_")),
    );
    const all = findings(fileOnly, "selfhost");
    expect(failed(all)).toBe(false);
    expect(status(all, "NEXT_PUBLIC_SOLANA_RPC_URL")).toContain("warning");
    expect(status(all, "NEXT_PUBLIC_SENTRY_DSN")).toContain("warning");
    // On Vercel they stay required: there the runtime env is the build env.
    const { AROMA_PLATFORM: _p, ...vercelFile } = fileOnly;
    expect(
      status(findings(vercelFile, "vercel"), "NEXT_PUBLIC_SOLANA_RPC_URL"),
    ).toContain("missing");
  });

  it("selfhost refuses a deploy env that is not the profile's", () => {
    const all = findings(
      { ...SELF_BETA, AROMA_DEPLOY_ENV: "development" },
      "selfhost",
    );
    expect(failed(all)).toBe(true);
    expect(status(all, "AROMA_DEPLOY_ENV")).toContain("invalid");
    expect(
      failed(
        findings(SELF_BETA, "selfhost", "production").filter(
          (f) => f.name === "AROMA_DEPLOY_ENV",
        ),
      ),
    ).toBe(true);
  });

  it("selfhost refuses a file that also carries Vercel's variables (contradiction)", () => {
    const all = findings(
      { ...SELF_BETA, VERCEL_ENV: "production" },
      "selfhost",
    );
    expect(failed(all)).toBe(true);
    expect(status(all, "AROMA_PLATFORM")).toContain("invalid");
  });

  it("vercel refuses a file that says selfhost", () => {
    const all = findings(SELF_BETA, "vercel");
    expect(failed(all)).toBe(true);
    expect(status(all, "AROMA_PLATFORM")).toContain("invalid");
  });

  it("selfhost still applies every production rule (a test switch is refused)", () => {
    const all = findings(
      { ...SELF_BETA, AROMA_V1_ALLOW_TEST_SWITCHES: "true" },
      "selfhost",
    );
    expect(failed(all)).toBe(true);
    expect(status(all, "AROMA_V1_ALLOW_TEST_SWITCHES")).toEqual(
      expect.arrayContaining(["invalid", "forbidden"]),
    );
  });

  it("the CLI takes --platform selfhost (offline), names the platform, and rejects other values", () => {
    const dir = mkdtempSync(join(tmpdir(), "aroma-selfhost-env-"));
    const file = join(dir, "aroma.env");
    const run = (env: Record<string, string>, platform: string) => {
      writeFileSync(
        file,
        Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
      );
      try {
        return {
          code: 0,
          out: execFileSync(
            "pnpm",
            [
              "exec",
              "tsx",
              "scripts/check-prod-env.ts",
              "--env-file",
              file,
              "--offline",
              "--profile",
              "beta",
              "--platform",
              platform,
            ],
            {
              cwd: fileURLToPath(new URL("..", import.meta.url)),
              encoding: "utf8",
              env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
              stdio: ["ignore", "pipe", "pipe"],
            },
          ),
        };
      } catch (error) {
        const e = error as { status: number; stdout: string };
        return { code: e.status, out: e.stdout };
      }
    };
    try {
      const ok = run(SELF_BETA, "selfhost");
      expect(ok.code).toBe(0);
      expect(ok.out).toMatch(/beta profile, selfhost/);
      const bad = run(BETA_GOOD, "selfhost");
      expect(bad.code).toBe(1);
      expect(bad.out).not.toContain(BETA_GOOD.AROMA_TRADE_SECRET);
      expect(run(SELF_BETA, "hostinger").code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
