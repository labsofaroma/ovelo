import { describe, expect, it, vi } from "vitest";
import {
  failed,
  genesisFindings,
  MAINNET_GENESIS,
  report,
  staticFindings,
  WEB_PRODUCTION,
} from "./prod-env";

vi.mock("@/features/compliance/terms", async (orig) =>
  (await import("@/server/test/final-terms")).withFinalTerms(await orig()),
);

/** P3: `pnpm check:prod-env` refuses an incomplete, placeholder or test production profile. */
const secret = (c: string) => c.repeat(40);
const GOOD = {
  AROMA_SITE_URL: "https://aroma.trade",
  SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=k",
  SOLANA_RPC_FALLBACK_URL: "https://aroma.mainnet.rpcpool.com/k",
  NEXT_PUBLIC_SOLANA_RPC_URL: "https://rpc.aroma.trade",
  DATABASE_URL: "postgres://u:p@ep-cool-1.neon.tech/aroma?sslmode=require",
  UPSTASH_REDIS_REST_URL: "https://eu1-good-1.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "AXXXtoken",
  AROMA_TRADE_SECRET: secret("t"),
  JUPITER_API_KEY: "jup-key",
  AROMA_MAX_TRADE_USDC_RAW: "50000000",
  AROMA_MAX_DAILY_USDC_RAW: "200000000",
  // A real-shaped DSN: the public key is URL userinfo (W4, server/env.sentry.ts).
  SENTRY_DSN: `https://${"a1".repeat(16)}@o4507.ingest.us.sentry.io/4508`,
  NEXT_PUBLIC_SENTRY_DSN: `https://${"b2".repeat(16)}@o4507.ingest.sentry.io/4509`,
  SENTRY_ENVIRONMENT: "production",
  JITO_BLOCK_ENGINE_URL: "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  AROMA_REVALIDATE_SECRET: secret("r"),
  PYTH_API_KEY: "pyth",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA-real",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-real-secret",
};
const byName = (env: Record<string, string>, name: string) =>
  staticFindings(env).filter((f) => f.name === name);

describe("staticFindings (production profile)", () => {
  it("a complete, real-looking profile passes", () => {
    const findings = staticFindings(GOOD);
    expect(failed(findings)).toBe(false);
    for (const { name } of WEB_PRODUCTION)
      expect(findings.find((f) => f.name === name)?.status).toBe("ok");
  });

  it.each(
    WEB_PRODUCTION.filter((i) => i.level === "required").map((i) => i.name),
  )("a missing required %s fails", (name) => {
    const env: Record<string, string> = { ...GOOD };
    delete env[name];
    expect(failed(staticFindings(env))).toBe(true);
  });

  it("a missing recommended variable only warns", () => {
    const { JITO_BLOCK_ENGINE_URL: _, ...env } = GOOD;
    expect(byName(env, "JITO_BLOCK_ENGINE_URL")[0]?.status).toBe("warning");
    expect(failed(staticFindings(env))).toBe(false);
  });

  it("the .env.example placeholders are refused", () => {
    const env = {
      ...GOOD,
      DATABASE_URL:
        "postgres://aroma:placeholder@db.placeholder.invalid/aroma?sslmode=require",
      UPSTASH_REDIS_REST_URL: "https://redis.placeholder.invalid",
      AROMA_TRADE_SECRET:
        "placeholder-trade-secret-replace-with-32-plus-random-chars",
    };
    for (const name of [
      "DATABASE_URL",
      "UPSTASH_REDIS_REST_URL",
      "AROMA_TRADE_SECRET",
    ])
      expect(byName(env, name).map((f) => f.status)).toContain("forbidden");
  });

  it.each([
    ["AROMA_V1_ALLOW_TEST_SWITCHES", "true"],
    ["NEXT_PUBLIC_AROMA_E2E_WALLET", "true"],
    ["NEXT_PUBLIC_AROMA_LOCALNET", "true"],
    [
      "AROMA_V1_TEST_FORK_GENESIS",
      "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
    ],
    ["AROMA_V1_TEST_JUPITER_URL", "http://127.0.0.1:4010"],
    ["AROMA_LOCAL_NEON_WS_PROXY", "127.0.0.1:54330"],
    ["TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA"],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA"],
    ["AROMA_COMPLIANCE_MISSING_COUNTRY", "allow"],
    ["AROMA_COMPLIANCE_RESTRICTED_COUNTRIES", "CU,IR"],
  ])("%s=<test value> is refused", (name, value) => {
    const findings = staticFindings({ ...GOOD, [name]: value });
    expect(failed(findings)).toBe(true);
    expect(findings.some((f) => f.name === name && f.status !== "ok")).toBe(
      true,
    );
  });

  it.each([
    "https://api.devnet.solana.com",
    "https://my-devnet.helius-rpc.com",
    "https://api.testnet.solana.com",
  ])("a non-mainnet SOLANA_RPC_URL (%s) is refused", (url) => {
    expect(
      byName({ ...GOOD, SOLANA_RPC_URL: url }, "SOLANA_RPC_URL").map(
        (f) => f.status,
      ),
    ).toContain("forbidden");
  });

  it("the public mainnet endpoint is allowed but warned (rate-limited)", () => {
    const findings = byName(
      { ...GOOD, SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" },
      "SOLANA_RPC_URL",
    );
    expect(findings.map((f) => f.status)).toContain("warning");
  });

  it("a real-shaped Sentry DSN passes (W4: the public key is userinfo)", () => {
    for (const dsn of [
      `https://${"c3".repeat(16)}@o1.ingest.sentry.io/1`,
      `https://${"c3".repeat(16)}@o1.ingest.de.sentry.io/22`,
    ]) {
      const env = { ...GOOD, SENTRY_DSN: dsn, NEXT_PUBLIC_SENTRY_DSN: dsn };
      expect(byName(env, "SENTRY_DSN").map((f) => f.status)).toEqual(["ok"]);
      expect(
        byName(env, "NEXT_PUBLIC_SENTRY_DSN").map((f) => f.status),
      ).toEqual(["ok"]);
      expect(failed(staticFindings(env))).toBe(false);
    }
  });

  it.each([
    ["no public key", "https://o1.ingest.sentry.io/1"],
    ["a secret key", `https://${"c3".repeat(16)}:s3cret@o1.ingest.sentry.io/1`],
    ["a non-Sentry host", `https://${"c3".repeat(16)}@o1.ingest.evil.io/1`],
    [
      "a non-numeric project",
      `https://${"c3".repeat(16)}@o1.ingest.sentry.io/x`,
    ],
  ])("a malformed Sentry DSN (%s) fails", (_label, dsn) => {
    for (const name of ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"]) {
      const findings = byName({ ...GOOD, [name]: dsn }, name);
      expect(findings[0]?.status).toBe("invalid");
      expect(findings[0]?.detail).toMatch(/^must be a Sentry DSN/);
      expect(failed(staticFindings({ ...GOOD, [name]: dsn }))).toBe(true);
    }
  });

  it("a rotation in progress is a warning, not a failure", () => {
    const findings = staticFindings({
      ...GOOD,
      AROMA_TRADE_SECRET_PREVIOUS: secret("p"),
    });
    expect(
      findings.find((f) => f.name === "AROMA_TRADE_SECRET_PREVIOUS")?.status,
    ).toBe("warning");
    expect(failed(findings)).toBe(false);
  });

  it("the report names variables and statuses, never values", () => {
    const env = {
      ...GOOD,
      DATABASE_URL: "postgres://u:supersecretvalue@x.placeholder.invalid/db",
    };
    const text = report(staticFindings(env));
    for (const value of Object.values(env)) expect(text).not.toContain(value);
    expect(text).not.toContain("supersecretvalue");
    expect(text).toMatch(/FORBIDDEN\s+DATABASE_URL/);
  });
});

describe("genesisFindings (read-only getGenesisHash)", () => {
  const reply = (result: unknown) =>
    vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ jsonrpc: "2.0", id: 1, result }),
    );

  it("mainnet genesis passes; only getGenesisHash is ever called", async () => {
    const fetch = reply(MAINNET_GENESIS);
    const findings = await genesisFindings(GOOD, fetch);
    // Primary, fallback (M9) and browser RPC, each on its own.
    expect(findings.map((f) => f.name)).toEqual([
      "SOLANA_RPC_URL",
      "SOLANA_RPC_FALLBACK_URL",
      "NEXT_PUBLIC_SOLANA_RPC_URL",
    ]);
    expect(findings.map((f) => f.status)).toEqual(["ok", "ok", "ok"]);
    for (const [, init] of fetch.mock.calls)
      expect(JSON.parse(String(init.body)).method).toBe("getGenesisHash");
  });

  it("a devnet genesis or an unreachable RPC fails", async () => {
    expect(
      failed(
        await genesisFindings(
          GOOD,
          reply("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
        ),
      ),
    ).toBe(true);
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const findings = await genesisFindings(GOOD, down);
    expect(findings.every((f) => f.status === "invalid")).toBe(true);
  });
});
