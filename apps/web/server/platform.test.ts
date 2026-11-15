import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  deployEnvOf,
  platformProblems,
  productionRules,
  resolvePlatform,
  type DeployEnv,
  type Platform,
} from "./platform";
import { parseEnv, testSwitchesAllowed } from "./env.schema";
import { hstsApplies } from "./csp";
import { betaGateOn } from "@/features/beta/config";
import { BASE_ENV as BASE } from "./test/base-env";

vi.mock("@/features/compliance/terms", async (orig) =>
  (await import("@/server/test/final-terms")).withFinalTerms(await orig()),
);

type Row = {
  name: string;
  env: Record<string, string>;
  platform: Platform | null;
  deployEnv: DeployEnv;
  production: boolean;
  /** Variables named by the refusal; empty means the boot accepts the answer. */
  refused: string[];
};

const PROD = { NODE_ENV: "production" };
const SECRET = "test-origin-secret-0123456789abcdefABCDEF";
const SELF = { OVELO_PLATFORM: "selfhost" };

/** Every (platform, deploy env) combination, plus the contradictions and the missing answers. */
const TABLE: Row[] = [
  // Vercel: today's VERCEL_ENV mapping, unchanged.
  ...(["production", "preview", "development"] as const).map((v) => ({
    name: `vercel ${v}`,
    env: { ...PROD, VERCEL: "1", VERCEL_ENV: v },
    platform: "vercel" as const,
    deployEnv: v,
    production: v === "production",
    refused: [],
  })),
  {
    name: "vercel production refined to beta",
    env: {
      ...PROD,
      VERCEL: "1",
      VERCEL_ENV: "production",
      OVELO_DEPLOY_ENV: "beta",
    },
    platform: "vercel",
    deployEnv: "beta",
    production: true,
    refused: [],
  },
  {
    name: "vercel with an explicit OVELO_PLATFORM=vercel",
    env: {
      ...PROD,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      OVELO_PLATFORM: "vercel",
    },
    platform: "vercel",
    deployEnv: "preview",
    production: false,
    refused: [],
  },
  // Self-host: both variables, every deploy environment.
  ...(["production", "beta", "preview", "development"] as const).map((d) => ({
    name: `selfhost ${d}`,
    env: { ...PROD, ...SELF, OVELO_DEPLOY_ENV: d },
    platform: "selfhost" as const,
    deployEnv: d,
    production: d === "production" || d === "beta",
    refused: [],
  })),
  // Missing answers.
  {
    name: "NODE_ENV=production, nothing else (refused, fail closed)",
    env: { ...PROD },
    platform: null,
    deployEnv: "development",
    production: true,
    refused: ["OVELO_PLATFORM"],
  },
  {
    name: "next build without a platform (exempt; still fail closed)",
    env: { ...PROD, NEXT_PHASE: "phase-production-build" },
    platform: null,
    deployEnv: "development",
    production: true,
    refused: [],
  },
  {
    name: "selfhost without OVELO_DEPLOY_ENV",
    env: { ...PROD, ...SELF },
    platform: "selfhost",
    deployEnv: "development",
    production: true,
    refused: ["OVELO_DEPLOY_ENV"],
  },
  {
    name: "OVELO_DEPLOY_ENV without a platform",
    env: { ...PROD, OVELO_DEPLOY_ENV: "production" },
    platform: null,
    deployEnv: "development",
    production: true,
    refused: ["OVELO_PLATFORM"],
  },
  {
    name: "Vercel flag without VERCEL_ENV in production",
    env: { ...PROD, VERCEL: "1" },
    platform: "vercel",
    deployEnv: "development",
    production: true,
    refused: ["VERCEL_ENV"],
  },
  // Contradictions.
  {
    name: "VERCEL_ENV=production and OVELO_DEPLOY_ENV=development",
    env: { ...PROD, VERCEL_ENV: "production", OVELO_DEPLOY_ENV: "development" },
    platform: "vercel",
    deployEnv: "production",
    production: true,
    refused: ["OVELO_DEPLOY_ENV"],
  },
  {
    name: "VERCEL_ENV=preview and OVELO_DEPLOY_ENV=production",
    env: { ...PROD, VERCEL_ENV: "preview", OVELO_DEPLOY_ENV: "production" },
    platform: "vercel",
    deployEnv: "preview",
    production: true,
    refused: ["OVELO_DEPLOY_ENV"],
  },
  {
    name: "VERCEL_ENV=preview refined to beta (beta is production only)",
    env: { ...PROD, VERCEL_ENV: "preview", OVELO_DEPLOY_ENV: "beta" },
    platform: "vercel",
    deployEnv: "preview",
    production: true,
    refused: ["OVELO_DEPLOY_ENV"],
  },
  {
    name: "OVELO_PLATFORM=selfhost on Vercel",
    env: {
      ...PROD,
      ...SELF,
      OVELO_DEPLOY_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
    },
    platform: "vercel",
    deployEnv: "production",
    production: true,
    refused: ["OVELO_PLATFORM"],
  },
  {
    name: "OVELO_PLATFORM=vercel off Vercel",
    env: { ...PROD, OVELO_PLATFORM: "vercel", OVELO_DEPLOY_ENV: "development" },
    platform: "vercel",
    deployEnv: "development",
    production: true,
    refused: ["OVELO_PLATFORM"],
  },
  // Unreadable values.
  {
    name: "unknown OVELO_PLATFORM",
    env: {
      ...PROD,
      OVELO_PLATFORM: "hostinger",
      OVELO_DEPLOY_ENV: "production",
    },
    platform: null,
    deployEnv: "development",
    production: true,
    refused: ["OVELO_PLATFORM"],
  },
  {
    name: "unknown OVELO_DEPLOY_ENV",
    env: { ...PROD, ...SELF, OVELO_DEPLOY_ENV: "staging" },
    platform: "selfhost",
    deployEnv: "development",
    production: true,
    refused: ["OVELO_DEPLOY_ENV"],
  },
  {
    name: "VERCEL set to something other than 1",
    env: { ...PROD, VERCEL: "true", VERCEL_ENV: "production" },
    platform: "vercel",
    deployEnv: "production",
    production: true,
    refused: ["VERCEL"],
  },
  // Development and tests: no answer needed.
  {
    name: "next dev (no platform)",
    env: { NODE_ENV: "development" },
    platform: null,
    deployEnv: "development",
    production: false,
    refused: [],
  },
  {
    name: "vitest (no platform)",
    env: { NODE_ENV: "test" },
    platform: null,
    deployEnv: "development",
    production: false,
    refused: [],
  },
];

describe("server/platform.ts: the (platform, deploy env) table", () => {
  it.each(TABLE)("$name", (row) => {
    const answer = resolvePlatform(row.env);
    expect(answer.platform).toBe(row.platform);
    expect(answer.deployEnv).toBe(row.deployEnv);
    expect(answer.productionRules).toBe(row.production);
    expect(productionRules(row.env)).toBe(row.production);
    expect(deployEnvOf(row.env)).toBe(row.deployEnv);
    expect(
      platformProblems(row.env)
        .map((p) => p.variable)
        .sort(),
    ).toEqual([...row.refused].sort());
  });

  it.each(TABLE)("the boot schema agrees: $name", (row) => {
    // Production rules need the caps (in BASE) and, on self-host, the Cloudflare proxy mode
    // (Step 2); give them so only the platform answer decides.
    const edge =
      row.platform === "selfhost"
        ? { OVELO_PROXY_MODE: "cloudflare", OVELO_ORIGIN_SECRET: SECRET }
        : {};
    const result = parseEnv({ ...BASE, ...edge, ...row.env });
    const named = result.ok ? [] : result.error.issues.map((i) => i.variable);
    for (const variable of row.refused) expect(named).toContain(variable);
    if (!row.refused.length) expect(result.ok).toBe(true);
  });

  it.each(TABLE)(
    "every production-rule reader follows the table: $name",
    (row) => {
      const p = row.production;
      // Test switches: never under production rules, even opted in.
      expect(
        testSwitchesAllowed({
          ...row.env,
          OVELO_V1_ALLOW_TEST_SWITCHES: "true",
        }),
      ).toBe(!p);
      // HSTS: only production rules, over HTTPS, never on loopback.
      expect(hstsApplies(row.env, false, "https")).toBe(p);
      expect(hstsApplies(row.env, true, "https")).toBe(false);
      // The beta gate defaults on under production rules (and under NODE_ENV=production).
      expect(betaGateOn(row.env)).toBe(p || row.env.NODE_ENV === "production");
    },
  );

  it("refuses the production-only switches on self-host production and beta (Step 0, finding 1)", () => {
    for (const deploy of ["production", "beta"]) {
      const result = parseEnv({
        ...BASE,
        ...PROD,
        ...SELF,
        OVELO_DEPLOY_ENV: deploy,
        OVELO_MAX_TRADE_USDC_RAW: "50000000",
        OVELO_MAX_DAILY_USDC_RAW: "200000000",
        OVELO_V1_ALLOW_TEST_SWITCHES: "true",
        OVELO_V1_TEST_FORK_GENESIS: "11111111111111111111111111111111",
        OVELO_V1_TEST_JUPITER_URL: "http://127.0.0.1:9",
        NEXT_PUBLIC_OVELO_E2E_WALLET: "true",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.issues.map((i) => i.variable)).toEqual(
          expect.arrayContaining([
            "OVELO_V1_ALLOW_TEST_SWITCHES",
            "OVELO_V1_TEST_FORK_GENESIS",
            "OVELO_V1_TEST_JUPITER_URL",
            "NEXT_PUBLIC_OVELO_E2E_WALLET",
            "TURNSTILE_SECRET_KEY",
          ]),
        );
    }
  });

  it("requires the caps on self-host production (as on Vercel production)", () => {
    const {
      OVELO_MAX_TRADE_USDC_RAW: _trade,
      OVELO_MAX_DAILY_USDC_RAW: _daily,
      ...uncapped
    } = BASE;
    const result = parseEnv({
      ...uncapped,
      ...PROD,
      ...SELF,
      OVELO_DEPLOY_ENV: "production",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues.map((i) => i.variable)).toEqual(
        expect.arrayContaining([
          "OVELO_MAX_TRADE_USDC_RAW",
          "OVELO_MAX_DAILY_USDC_RAW",
        ]),
      );
  });
});

describe("VERCEL* is read only by server/platform.ts", () => {
  it("no other source file reads a VERCEL* property", () => {
    const root = join(import.meta.dirname, "..");
    const files = execFileSync(
      "git",
      ["ls-files", "--", "*.ts", "*.tsx", "*.mts", "*.mjs", "*.js"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => f !== "server/platform.ts" && !/\.test\.tsx?$/.test(f));
    const offenders = files.filter((file) =>
      /\.VERCEL[A-Z_]*\b|\[\s*["']VERCEL[A-Z_]*["']\s*\]/.test(
        readFileSync(join(root, file), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
