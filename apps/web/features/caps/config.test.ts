import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env.schema";
import {
  BETA_DEFAULT_DAILY_RAW,
  BETA_DEFAULT_TRADE_RAW,
  capsConfig,
  CapsConfigError,
  usd,
  utcDay,
} from "./config";

describe("W3 caps config", () => {
  it("defaults to $50 per trade and $200 per day outside production", () => {
    expect(capsConfig({ NODE_ENV: "development" })).toEqual({
      perTrade: BETA_DEFAULT_TRADE_RAW,
      daily: BETA_DEFAULT_DAILY_RAW,
    });
    expect(BETA_DEFAULT_TRADE_RAW).toBe(50_000_000n);
    expect(BETA_DEFAULT_DAILY_RAW).toBe(200_000_000n);
  });

  it("parses raw USDC units to bigint", () => {
    expect(
      capsConfig({
        NODE_ENV: "production",
        AROMA_MAX_TRADE_USDC_RAW: "25000000",
        AROMA_MAX_DAILY_USDC_RAW: "18446744073709551615",
      }),
    ).toEqual({ perTrade: 25_000_000n, daily: 18_446_744_073_709_551_615n });
  });

  it.each([
    [
      { NODE_ENV: "production" },
      ["AROMA_MAX_TRADE_USDC_RAW", "AROMA_MAX_DAILY_USDC_RAW"],
    ],
    [
      { VERCEL_ENV: "production", AROMA_MAX_TRADE_USDC_RAW: "1" },
      ["AROMA_MAX_DAILY_USDC_RAW"],
    ],
    [{ AROMA_MAX_TRADE_USDC_RAW: "0" }, ["AROMA_MAX_TRADE_USDC_RAW"]],
    [{ AROMA_MAX_TRADE_USDC_RAW: "1.5" }, ["AROMA_MAX_TRADE_USDC_RAW"]],
    [
      { AROMA_MAX_DAILY_USDC_RAW: "18446744073709551616" },
      ["AROMA_MAX_DAILY_USDC_RAW"],
    ],
    [
      { AROMA_MAX_TRADE_USDC_RAW: "300", AROMA_MAX_DAILY_USDC_RAW: "200" },
      ["AROMA_MAX_DAILY_USDC_RAW"],
    ],
  ])(
    "refuses %j (unset or 0 in production, malformed, daily below per-trade)",
    (env, names) => {
      try {
        capsConfig(env);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(CapsConfigError);
        expect((error as CapsConfigError).variables).toEqual(names);
      }
    },
  );

  it("boot: production with v1 on requires both caps; 0 and decimals are refused anywhere", () => {
    const base = { VERCEL_ENV: "production" };
    const issues = (env: Record<string, string>) => {
      const result = parseEnv(env);
      return result.ok ? [] : result.error.issues.map((i) => i.variable);
    };
    expect(issues({ ...base, AROMA_V1_ENABLED: "true" })).toEqual(
      expect.arrayContaining([
        "AROMA_MAX_TRADE_USDC_RAW",
        "AROMA_MAX_DAILY_USDC_RAW",
      ]),
    );
    expect(issues({ AROMA_MAX_TRADE_USDC_RAW: "0" })).toEqual([
      "AROMA_MAX_TRADE_USDC_RAW",
    ]);
    expect(issues({ AROMA_MAX_DAILY_USDC_RAW: "2e8" })).toEqual([
      "AROMA_MAX_DAILY_USDC_RAW",
    ]);
    expect(
      issues({
        AROMA_MAX_TRADE_USDC_RAW: "50000000",
        AROMA_MAX_DAILY_USDC_RAW: "200000000",
      }),
    ).toEqual([]);
  });

  it("formats for messages without rounding up, and days are UTC", () => {
    expect(usd(50_000_000n)).toBe("$50");
    expect(usd(12_345_678n)).toBe("$12.34");
    expect(usd(0n)).toBe("$0");
    expect(utcDay(new Date("2026-11-14T23:59:59.999Z"))).toBe("2026-11-14");
    expect(utcDay(new Date("2026-11-15T00:00:00.000Z"))).toBe("2026-11-15");
  });
});
