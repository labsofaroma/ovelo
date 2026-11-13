import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv, validateEnv } from "./env.schema";

const V1: Record<string, string> = {
  AROMA_V1_ENABLED: "true",
  SOLANA_RPC_URL: "https://mainnet.example.com/rpc",
  DATABASE_URL: "postgres://user:pw@db.example.com/aroma",
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "token-value",
  AROMA_TRADE_SECRET: "x".repeat(32),
};

describe("validateEnv", () => {
  it("accepts an empty environment while v1 is off (the prototype keeps booting)", () => {
    const env = validateEnv({});
    expect(env.server.AROMA_V1_ENABLED).toBe(false);
    expect(env.server.NODE_ENV).toBe("development");
  });

  it("groups variables as public, server, devnet and keeper", () => {
    const env = validateEnv({
      ...V1,
      NEXT_PUBLIC_PRIVY_APP_ID: "app",
      AROMA_RECURRING_RPC_URL: "https://api.devnet.solana.com",
      QSTASH_TOKEN: "q",
    });
    expect(env.public.NEXT_PUBLIC_PRIVY_APP_ID).toBe("app");
    expect(env.server.DATABASE_URL).toContain("postgres://");
    expect(env.devnet.AROMA_RECURRING_RPC_URL).toContain("devnet");
    expect(env.keeper.QSTASH_TOKEN).toBe("q");
  });

  it("names every missing required variable when v1 is enabled", () => {
    const result = parseEnv({ AROMA_V1_ENABLED: "true" });
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
      "DATABASE_URL (server): is required when AROMA_V1_ENABLED=true",
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

  it("still validates formats of set variables when v1 is off", () => {
    expect(parseEnv({ AROMA_RECURRING_AUTH_SECRET: "tooshort" }).ok).toBe(
      false,
    );
  });
});
