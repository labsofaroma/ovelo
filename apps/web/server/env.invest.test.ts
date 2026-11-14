import { describe, expect, it } from "vitest";
import { parseEnv, TURNSTILE_TEST_SECRETS } from "./env.schema";

const LOCALNET: Record<string, string> = {
  AROMA_V1_INVEST_CLUSTER: "localnet",
  AROMA_V1_ALLOW_TEST_SWITCHES: "true",
  NEXT_PUBLIC_AROMA_LOCALNET: "true",
  AROMA_V1_LOCALNET_RPC_URL: "http://127.0.0.1:8899",
  AROMA_V1_LOCALNET_GENESIS: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  AROMA_V1_LOCALNET_FUNDING_MINT: "So11111111111111111111111111111111111111112",
};

function problems(source: Record<string, string>): string[] {
  const result = parseEnv(source);
  return result.ok
    ? []
    : result.error.issues.map((i) => `${i.variable}: ${i.problem}`);
}

describe("M7 invest environment", () => {
  it("defaults to devnet and accepts a full localnet test configuration", () => {
    const devnet = parseEnv({});
    expect(devnet.ok && devnet.env.devnet.AROMA_V1_INVEST_CLUSTER).toBe(
      "devnet",
    );
    expect(problems(LOCALNET)).toEqual([]);
  });

  it("localnet needs test switches, the localnet build flag and every localnet variable", () => {
    expect(
      problems({ ...LOCALNET, AROMA_V1_ALLOW_TEST_SWITCHES: "false" }),
    ).toContain(
      "AROMA_V1_INVEST_CLUSTER: localnet needs AROMA_V1_ALLOW_TEST_SWITCHES=true",
    );
    expect(
      problems({ ...LOCALNET, NEXT_PUBLIC_AROMA_LOCALNET: "false" }),
    ).toContain(
      "AROMA_V1_INVEST_CLUSTER: localnet needs a NEXT_PUBLIC_AROMA_LOCALNET=true build",
    );
    const { AROMA_V1_LOCALNET_GENESIS: _drop, ...partial } = LOCALNET;
    expect(problems(partial)).toContain(
      "AROMA_V1_LOCALNET_GENESIS: is required when AROMA_V1_INVEST_CLUSTER=localnet",
    );
  });

  it("the localnet RPC must be loopback http", () => {
    expect(
      problems({
        ...LOCALNET,
        AROMA_V1_LOCALNET_RPC_URL: "https://api.devnet.solana.com",
      }),
    ).toContain("AROMA_V1_LOCALNET_RPC_URL: must be a loopback http URL");
  });

  it("production refuses the localnet flag, the localnet cluster and every localnet variable", () => {
    const found = problems({ ...LOCALNET, VERCEL_ENV: "production" });
    for (const key of [
      "NEXT_PUBLIC_AROMA_LOCALNET",
      "AROMA_V1_INVEST_CLUSTER",
      "AROMA_V1_LOCALNET_RPC_URL",
      "AROMA_V1_LOCALNET_GENESIS",
      "AROMA_V1_LOCALNET_FUNDING_MINT",
    ])
      expect(found.some((line) => line.startsWith(`${key}:`))).toBe(true);
    expect(
      problems({
        NEXT_PUBLIC_AROMA_LOCALNET: "true",
        VERCEL_ENV: "production",
      }),
    ).toEqual([
      "NEXT_PUBLIC_AROMA_LOCALNET: must not be set in a production deployment",
    ]);
  });

  it("production refuses Cloudflare's Turnstile test secrets; previews may use them", () => {
    for (const secret of TURNSTILE_TEST_SECRETS) {
      expect(
        problems({ TURNSTILE_SECRET_KEY: secret, VERCEL_ENV: "production" }),
      ).toEqual([
        "TURNSTILE_SECRET_KEY: must not be a Cloudflare test secret in production",
      ]);
      expect(
        problems({ TURNSTILE_SECRET_KEY: secret, VERCEL_ENV: "preview" }),
      ).toEqual([]);
    }
  });

  it("the faucet key must be a 64-byte JSON array and the daily budget a bounded integer", () => {
    const key = JSON.stringify(
      Array.from({ length: 64 }, (_, i) => (i * 7) % 256),
    );
    expect(problems({ AROMA_V1_FAUCET_KEYPAIR: key })).toEqual([]);
    expect(problems({ AROMA_V1_FAUCET_KEYPAIR: "[1,2,3]" })).toEqual([
      "AROMA_V1_FAUCET_KEYPAIR: must be a 64-byte JSON array",
    ]);
    expect(problems({ AROMA_V1_FAUCET_DAILY_CLAIMS: "0" })).toHaveLength(1);
    expect(problems({ AROMA_V1_FAUCET_DAILY_CLAIMS: "200" })).toEqual([]);
  });
});

describe("local Redis proxy URL (M7 E2E)", () => {
  it("accepts loopback http only for a local run with test switches, never in production", () => {
    const local = { UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079" };
    expect(problems(local)).toEqual([]);
    expect(problems({ ...local, NODE_ENV: "production" })).toEqual([
      "UPSTASH_REDIS_REST_URL: must be an https:// URL",
    ]);
    expect(
      problems({
        ...local,
        NODE_ENV: "production",
        AROMA_V1_ALLOW_TEST_SWITCHES: "true",
      }),
    ).toEqual([]);
    expect(problems({ ...local, VERCEL_ENV: "production" })).toContain(
      "UPSTASH_REDIS_REST_URL: must be an https:// URL",
    );
    expect(
      problems({ UPSTASH_REDIS_REST_URL: "http://redis.example.com" }),
    ).toEqual(["UPSTASH_REDIS_REST_URL: must be an https:// URL"]);
  });
});
