import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBootEnv, resetEnvCacheForTests } from "./env";
import { EnvValidationError, parseEnv, validateEnv } from "./env.schema";

const V1: Record<string, string> = {
  SOLANA_RPC_URL: "https://mainnet.example.com/rpc",
  DATABASE_URL: "postgres://user:pw@db.example.com/aroma",
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "token-value",
  AROMA_TRADE_SECRET: "x".repeat(32),
};

describe("validateEnv", () => {
  it("refuses an empty environment (M9: no feature flag; the required variables always apply)", () => {
    expect(() => validateEnv({})).toThrow(EnvValidationError);
    expect(validateEnv(V1).server.NODE_ENV).toBe("development");
    expect(validateEnv(V1).server.AROMA_TRADING).toBe("on");
  });

  it("groups variables as public, server, devnet and keeper", () => {
    const env = validateEnv({
      ...V1,
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "aroma.trade",
      AROMA_RECURRING_RPC_URL: "https://api.devnet.solana.com",
      QSTASH_TOKEN: "q",
    });
    expect(env.public.NEXT_PUBLIC_PLAUSIBLE_DOMAIN).toBe("aroma.trade");
    expect(env.server.DATABASE_URL).toContain("postgres://");
    expect(env.devnet.AROMA_RECURRING_RPC_URL).toContain("devnet");
    expect(env.keeper.QSTASH_TOKEN).toBe("q");
  });

  it("names every missing required variable", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const names = result.error.issues.map((i) => i.variable);
    expect(names).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "UPSTASH_REDIS_REST_URL",
        "UPSTASH_REDIS_REST_TOKEN",
        "AROMA_TRADE_SECRET",
        "SOLANA_RPC_URL",
      ]),
    );
    expect(result.error.message).toContain(
      "DATABASE_URL (server): is required",
    );
  });

  it("fails when a single required secret is removed", () => {
    const { AROMA_TRADE_SECRET: _removed, ...rest } = V1;
    expect(() => validateEnv(rest)).toThrow(EnvValidationError);
    expect(() => validateEnv(rest)).toThrow(/AROMA_TRADE_SECRET/);
  });

  it("treats blank values as unset", () => {
    const result = parseEnv({ ...V1, DATABASE_URL: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed values and never echoes the value", () => {
    const secret = "short-secret-value-123";
    const result = parseEnv({
      ...V1,
      AROMA_TRADE_SECRET: secret,
      DATABASE_URL: "mysql://nope",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(
      /AROMA_TRADE_SECRET \(server\): must be at least 32 characters/,
    );
    expect(result.error.message).toMatch(/DATABASE_URL/);
    expect(result.error.message).not.toContain(secret);
    expect(result.error.message).not.toContain("mysql://nope");
  });

  it("requires https for RPC and rejects embedded credentials", () => {
    expect(
      parseEnv({ ...V1, SOLANA_RPC_URL: "http://rpc.example.com" }).ok,
    ).toBe(false);
    expect(
      parseEnv({ ...V1, SOLANA_RPC_URL: "https://user:pw@rpc.example.com" }).ok,
    ).toBe(false);
  });

  it("AROMA_TRADING accepts only on and off (the emergency stop)", () => {
    expect(parseEnv({ ...V1, AROMA_TRADING: "off" }).ok).toBe(true);
    expect(parseEnv({ ...V1, AROMA_TRADING: "paused" }).ok).toBe(false);
  });
});

describe("assertBootEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCacheForTests();
    vi.restoreAllMocks();
  });

  function boot(env: Record<string, string | undefined>) {
    process.env = { ...saved, ...env };
    for (const key of Object.keys(env))
      if (env[key] === undefined) delete process.env[key];
    resetEnvCacheForTests();
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    assertBootEnv();
    return {
      exit,
      output: stderr.mock.calls.map((call) => String(call[0])).join(""),
    };
  }

  it("exits 1 and names the variable when a required secret is missing", () => {
    const { exit, output } = boot({ ...V1, AROMA_TRADE_SECRET: undefined });
    expect(exit).toHaveBeenCalledWith(1);
    expect(output).toContain("AROMA_TRADE_SECRET");
  });

  it("does not exit when the environment is valid", () => {
    expect(boot(V1).exit).not.toHaveBeenCalled();
  });

  it("exits even with no variables at all (M9: there is no prototype mode to fall back to)", () => {
    const { exit } = boot({
      DATABASE_URL: undefined,
      AROMA_TRADE_SECRET: undefined,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
