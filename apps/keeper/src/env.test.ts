import { describe, expect, it } from "vitest";
import { parseKeeperEnv, type KeeperEnvError } from "./env";

const key = JSON.stringify(
  Array.from({ length: 64 }, (_, i) => (i * 11) % 256),
);
const base = {
  KEEPER_KEYPAIR: key,
  QSTASH_CURRENT_SIGNING_KEY: "sig_current_xxxxxxxxxxxxxxxx",
  QSTASH_NEXT_SIGNING_KEY: "sig_next_yyyyyyyyyyyyyyyyyyy",
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "token",
  DATABASE_URL: "postgres://u:p@db.example.com/ovelo",
};
const problems = (source: Record<string, string>) => {
  try {
    parseKeeperEnv(source);
    return [];
  } catch (error) {
    return (error as KeeperEnvError).problems;
  }
};

describe("keeper environment", () => {
  it("defaults to devnet over HTTPS with safe limits", () => {
    expect(parseKeeperEnv(base)).toMatchObject({
      KEEPER_CLUSTER: "devnet",
      KEEPER_RPC_URL: "https://api.devnet.solana.com",
      KEEPER_MAX_ATTEMPTS: 3,
      KEEPER_MIN_SOL_LAMPORTS: 500_000_000,
    });
  });

  it("devnet refuses plain HTTP anywhere; localnet needs the opt-in, a genesis and a loopback RPC; never in production", () => {
    expect(
      problems({ ...base, UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079" }),
    ).toContain("UPSTASH_REDIS_REST_URL: must be https:// on devnet");
    const local = {
      ...base,
      KEEPER_CLUSTER: "localnet",
      KEEPER_RPC_URL: "http://127.0.0.1:8899",
      KEEPER_ALLOW_LOCALNET: "true",
      KEEPER_LOCALNET_GENESIS: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
      UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079",
    };
    expect(problems(local)).toEqual([]);
    expect(problems({ ...local, KEEPER_ALLOW_LOCALNET: "false" })).toContain(
      "KEEPER_CLUSTER: localnet needs KEEPER_ALLOW_LOCALNET=true",
    );
    expect(problems({ ...local, NODE_ENV: "production" })).toContain(
      "KEEPER_CLUSTER: localnet is refused in production",
    );
    expect(
      problems({ ...local, KEEPER_RPC_URL: "https://api.devnet.solana.com" }),
    ).toContain("KEEPER_RPC_URL: localnet needs a loopback RPC");
    expect(
      problems({ ...base, KEEPER_RPC_URL: "http://evil.example" }),
    ).toContain(
      "KEEPER_RPC_URL: must be https:// (loopback http only for a local run)",
    );
  });

  it("refuses a malformed key, equal signing keys, and never echoes values", () => {
    const found = problems({
      ...base,
      KEEPER_KEYPAIR: "[1,2,3]",
      QSTASH_NEXT_SIGNING_KEY: base.QSTASH_CURRENT_SIGNING_KEY,
    });
    expect(found).toEqual(
      expect.arrayContaining([
        "KEEPER_KEYPAIR: must be a 64-byte JSON array",
        "QSTASH_NEXT_SIGNING_KEY: must differ from the current signing key",
      ]),
    );
    expect(found.join("\n")).not.toContain(base.QSTASH_CURRENT_SIGNING_KEY);
    expect(problems({})).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^KEEPER_KEYPAIR:/),
        expect.stringMatching(/^DATABASE_URL:/),
      ]),
    );
  });
});
