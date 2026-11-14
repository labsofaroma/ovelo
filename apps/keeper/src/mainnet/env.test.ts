import { describe, expect, it } from "vitest";
import { MAINNET_GENESIS_HASH, DEVNET_GENESIS_HASH } from "@aroma/guard";
import { parseKeeperEnv, type KeeperEnvError } from "../env";
import { connectRpc, expectedGenesis } from "../rpc";
import { keeperSigner } from "../run";
import { fakeKeeperChain } from "../test/chain";
import { freshSecret } from "../test/world";

const key = (seed: number) =>
  JSON.stringify(Array.from({ length: 64 }, (_, i) => (i * seed) % 256));
const shared = {
  QSTASH_CURRENT_SIGNING_KEY: "sig_current_xxxxxxxxxxxxxxxx",
  QSTASH_NEXT_SIGNING_KEY: "sig_next_yyyyyyyyyyyyyyyyyyy",
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "token",
  DATABASE_URL: "postgres://u:p@db.example.com/aroma",
};
const mainnet = {
  ...shared,
  KEEPER_CLUSTER: "mainnet",
  KEEPER_RPC_URL: "https://rpc.example.com",
  KEEPER_MAINNET_KEYPAIR: key(13),
};
const problems = (source: Record<string, string>) => {
  try {
    parseKeeperEnv(source);
    return [];
  } catch (error) {
    return (error as KeeperEnvError).problems;
  }
};

describe("mainnet keeper environment (M8 B5)", () => {
  it("mainnet uses its own key, defaults to 2 routed legs per transaction and Jupiter's API", () => {
    expect(parseKeeperEnv(mainnet)).toMatchObject({
      KEEPER_CLUSTER: "mainnet",
      KEEPER_MAINNET_LEGS_PER_TX: 2,
      KEEPER_JUPITER_URL: "https://api.jup.ag",
    });
  });

  it("the devnet key never runs on mainnet and the mainnet key never on devnet", () => {
    expect(problems({ ...mainnet, KEEPER_KEYPAIR: key(11) })).toContain(
      "KEEPER_KEYPAIR: the devnet key must not be set on mainnet (use KEEPER_MAINNET_KEYPAIR)",
    );
    expect(problems({ ...mainnet, KEEPER_KEYPAIR: key(13) })).toContain(
      "KEEPER_MAINNET_KEYPAIR: must differ from the devnet key",
    );
    const { KEEPER_MAINNET_KEYPAIR: _, ...noKey } = mainnet;
    expect(problems(noKey)).toContain(
      "KEEPER_MAINNET_KEYPAIR: is required on mainnet",
    );
    expect(
      problems({
        ...shared,
        KEEPER_KEYPAIR: key(11),
        KEEPER_MAINNET_KEYPAIR: key(13),
      }),
    ).toContain(
      "KEEPER_MAINNET_KEYPAIR: the mainnet key is refused on devnet and localnet",
    );
    expect(problems(shared)).toContain("KEEPER_KEYPAIR: is required");
  });

  it("mainnet: https everywhere, no devnet RPC, no fork switch, Jito needs a tip, keys in production", () => {
    expect(
      problems({ ...mainnet, KEEPER_RPC_URL: "https://api.devnet.solana.com" }),
    ).toContain("KEEPER_RPC_URL: must be a mainnet RPC");
    expect(
      problems({ ...mainnet, KEEPER_JUPITER_URL: "http://127.0.0.1:4010" }),
    ).toContain("KEEPER_JUPITER_URL: must be https:// on mainnet");
    expect(problems({ ...mainnet, KEEPER_ALLOW_FORK: "true" })).toContain(
      "KEEPER_ALLOW_FORK: is refused on mainnet",
    );
    expect(
      problems({
        ...mainnet,
        KEEPER_JITO_URL: "https://jito.example.com/api/v1/transactions",
      }),
    ).toContain("KEEPER_JITO_TIP_LAMPORTS: a Jito URL needs a tip");
    expect(problems({ ...mainnet, NODE_ENV: "production" })).toEqual(
      expect.arrayContaining([
        "JUPITER_API_KEY: is required on mainnet in production",
        "PYTH_API_KEY: is required on mainnet in production",
      ]),
    );
    expect(
      problems({ ...mainnet, KEEPER_MAINNET_LEGS_PER_TX: "3" })[0],
    ).toMatch(/^KEEPER_MAINNET_LEGS_PER_TX/);
  });

  it("mainnet-fork: opt-in, loopback, its own genesis, never in production", () => {
    const fork = {
      ...mainnet,
      KEEPER_CLUSTER: "mainnet-fork",
      KEEPER_RPC_URL: "http://127.0.0.1:8899",
    };
    expect(problems(fork)).toEqual(
      expect.arrayContaining([
        "KEEPER_CLUSTER: mainnet-fork needs KEEPER_ALLOW_FORK=true",
        "KEEPER_FORK_GENESIS: is required for mainnet-fork",
      ]),
    );
    const ok = {
      ...fork,
      KEEPER_ALLOW_FORK: "true",
      KEEPER_FORK_GENESIS: DEVNET_GENESIS_HASH.replace(/./, "F"),
    };
    expect(problems(ok)).toEqual([]);
    expect(problems({ ...ok, NODE_ENV: "production" })).toContain(
      "KEEPER_CLUSTER: mainnet-fork is refused in production",
    );
    expect(
      problems({ ...ok, KEEPER_RPC_URL: "https://rpc.example.com" }),
    ).toContain("KEEPER_RPC_URL: mainnet-fork needs a loopback RPC");
  });

  it("genesis per cluster: mainnet only in mainnet mode; the fork never mainnet's or devnet's", async () => {
    expect(expectedGenesis({ KEEPER_CLUSTER: "mainnet" })).toBe(
      MAINNET_GENESIS_HASH,
    );
    const env = (cluster: string, genesis: string, fork?: string) => {
      const chain = fakeKeeperChain({ genesis });
      return connectRpc(
        {
          KEEPER_CLUSTER: cluster as never,
          KEEPER_RPC_URL: "http://127.0.0.1:8899",
          KEEPER_FORK_GENESIS: fork,
        },
        chain.transport,
      );
    };
    await expect(env("mainnet", MAINNET_GENESIS_HASH)).resolves.toBeTruthy();
    await expect(env("mainnet", DEVNET_GENESIS_HASH)).rejects.toThrow(
      /genesis/,
    );
    await expect(env("devnet", MAINNET_GENESIS_HASH)).rejects.toThrow(
      /genesis/,
    );
    await expect(
      env("mainnet-fork", MAINNET_GENESIS_HASH, MAINNET_GENESIS_HASH),
    ).rejects.toThrow(/genesis/);
    await expect(
      env("mainnet-fork", DEVNET_GENESIS_HASH, DEVNET_GENESIS_HASH),
    ).rejects.toThrow(/genesis/);
    const fork = "Fork1111111111111111111111111111111111111111";
    await expect(env("mainnet-fork", fork, fork)).resolves.toBeTruthy();
  });

  it("signs with the cluster's key", async () => {
    const [d, m] = [
      JSON.stringify(await freshSecret()),
      JSON.stringify(await freshSecret()),
    ];
    const devnet = await keeperSigner({
      KEEPER_CLUSTER: "devnet",
      KEEPER_KEYPAIR: d,
    });
    const main = await keeperSigner({
      KEEPER_CLUSTER: "mainnet",
      KEEPER_KEYPAIR: d,
      KEEPER_MAINNET_KEYPAIR: m,
    });
    expect(main.address).not.toBe(devnet.address);
    await expect(
      keeperSigner({ KEEPER_CLUSTER: "mainnet", KEEPER_KEYPAIR: d }),
    ).rejects.toThrow(/No keeper key/);
  });
});
