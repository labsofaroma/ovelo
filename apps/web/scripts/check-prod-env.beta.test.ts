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
 * Phase A W1 + beta profile: the prototype's embedded-wallet (Privy) variables must stay off the
 * wallet-only beta deployment. Kept outside the v1 paths on purpose: `grep -ri privy` over them
 * stays empty (REWRITE-PLAN §7.3 W1).
 */
const findings = (env: Record<string, string>) => [
  ...staticFindings(env),
  ...betaFindings(env),
];

describe("check:prod-env --profile beta", () => {
  it("refuses the prototype's Privy app id", () => {
    const env = { ...BETA_GOOD, NEXT_PUBLIC_PRIVY_APP_ID: "privy-app" };
    expect(
      findings(env).find((f) => f.name === "NEXT_PUBLIC_PRIVY_APP_ID")?.status,
    ).toBe("forbidden");
    expect(failed(findings(env))).toBe(true);
  });

  it("the CLI exits 0 on a complete beta file (offline) and 1 with Privy set; values never printed", () => {
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
              env: { PATH: process.env.PATH ?? "" },
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
        NEXT_PUBLIC_PRIVY_APP_ID: "privy-app-id-value",
      });
      expect(bad.code).toBe(1);
      expect(bad.out).toMatch(/FORBIDDEN +NEXT_PUBLIC_PRIVY_APP_ID/);
      expect(bad.out).not.toContain("privy-app-id-value");
      expect(bad.out).not.toContain(BETA_GOOD.AROMA_TRADE_SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
