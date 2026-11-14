import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { failed, staticFindings } from "../server/prod-env";
import { betaFindings } from "../server/prod-env.beta";
import { BETA_GOOD } from "../server/test/beta-env";

/**
 * Phase A W1 + beta profile: a browser-visible variable v1 does not read (for example a leftover
 * embedded-wallet login id) must stay off the wallet-only beta deployment. The check is generic:
 * any NEXT_PUBLIC_* outside the v1 schema is refused (REWRITE-PLAN §7.3 W1).
 */
const findings = (env: Record<string, string>) => [
  ...staticFindings(env),
  ...betaFindings(env),
];

describe("check:prod-env --profile beta", () => {
  it("refuses a browser variable v1 does not read", () => {
    const env = { ...BETA_GOOD, NEXT_PUBLIC_LEGACY_LOGIN_APP_ID: "legacy-login-app" };
    expect(
      findings(env).find((f) => f.name === "NEXT_PUBLIC_LEGACY_LOGIN_APP_ID")?.status,
    ).toBe("forbidden");
    expect(failed(findings(env))).toBe(true);
  });

  it("the CLI exits 0 on a complete beta file (offline) and 1 with an unknown browser variable set; values never printed", () => {
    const dir = mkdtempSync(join(tmpdir(), "aroma-beta-env-"));
    const file = join(dir, "beta.env");
    const run = (env: Record<string, string>) => {
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
            ],
            {
              cwd: fileURLToPath(new URL("..", import.meta.url)),
              encoding: "utf8",
              // Only PATH: the check must see the env FILE, not this process's variables.
              env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
            },
          ),
        };
      } catch (error) {
        const e = error as { status: number; stdout: string };
        return { code: e.status, out: e.stdout };
      }
    };
    try {
      const ok = run(BETA_GOOD);
      expect(ok.code).toBe(0);
      expect(ok.out).toMatch(/beta profile/);
      expect(ok.out).toMatch(/check:prod-env: OK/);
      const bad = run({
        ...BETA_GOOD,
        NEXT_PUBLIC_LEGACY_LOGIN_APP_ID: "legacy-login-id-value",
      });
      expect(bad.code).toBe(1);
      expect(bad.out).toMatch(/FORBIDDEN +NEXT_PUBLIC_LEGACY_LOGIN_APP_ID/);
      expect(bad.out).not.toContain("legacy-login-id-value");
      expect(bad.out).not.toContain(BETA_GOOD.AROMA_TRADE_SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
