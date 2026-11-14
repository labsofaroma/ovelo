import { BASE_ENV } from "@/server/test/base-env";
import type * as GuardExports from "@aroma/guard";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "@aroma/guard";
import { describe, expect, it, vi } from "vitest";
import { parseEnv, type Env } from "@/server/env.schema";
import { fakeChain } from "./test-chain";

type GuardModule = typeof GuardExports;

const LOCAL = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const env = (source: Record<string, string>): Env => {
  // M9: every environment carries the always-required variables.
  const result = parseEnv({ ...BASE_ENV, ...source });
  if (!result.ok) throw result.error;
  return result.env;
};
const localnet = {
  AROMA_V1_INVEST_CLUSTER: "localnet",
  AROMA_V1_ALLOW_TEST_SWITCHES: "true",
  NEXT_PUBLIC_AROMA_LOCALNET: "true",
  AROMA_V1_LOCALNET_RPC_URL: "http://127.0.0.1:8899",
  AROMA_V1_LOCALNET_GENESIS: LOCAL,
  AROMA_V1_LOCALNET_FUNDING_MINT: "So11111111111111111111111111111111111111112",
};

async function load(deployment: unknown) {
  vi.resetModules();
  vi.doMock("@aroma/guard", async (original) => ({
    ...(await original<GuardModule>()),
    V1_DEPLOYMENTS: { devnet: deployment, mainnet: null },
  }));
  return import("./cluster");
}

describe("invest cluster (B0/B2)", () => {
  it("devnet is unavailable while V1_DEPLOYMENTS.devnet is null: never faked", async () => {
    const { resolveInvestNetwork, requireInvestNetwork } = await load(null);
    expect(resolveInvestNetwork(env({}))).toEqual({
      available: false,
      cluster: "devnet",
      reason: "not_deployed",
    });
    expect(() => requireInvestNetwork(env({}))).toThrow(
      expect.objectContaining({ code: "INVEST_UNAVAILABLE" }),
    );
  });

  it("devnet with a deployment record; a record for the wrong genesis is misconfigured", async () => {
    const record = {
      cluster: "devnet",
      genesisHash: DEVNET_GENESIS_HASH,
      programId: "FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU",
      deploySignature: "x",
      fundingMint: "So11111111111111111111111111111111111111112",
    };
    const { resolveInvestNetwork } = await load(record);
    const ok = resolveInvestNetwork(
      env({ NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL: "https://devnet.example" }),
    );
    expect(ok).toMatchObject({
      available: true,
      network: {
        cluster: "devnet",
        browserRpcUrl: "https://devnet.example",
        rpcUrl: "https://api.devnet.solana.com",
      },
    });
    const wrong = await load({ ...record, genesisHash: MAINNET_GENESIS_HASH });
    expect(wrong.resolveInvestNetwork(env({}))).toMatchObject({
      available: false,
      reason: "misconfigured",
    });
  });

  it("the devnet test period is on only where test switches are allowed, never in Vercel production", async () => {
    const { resolveInvestNetwork } = await load({
      cluster: "devnet",
      genesisHash: DEVNET_GENESIS_HASH,
      programId: "FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU",
      deploySignature: "x",
      fundingMint: "So11111111111111111111111111111111111111112",
    });
    const testPeriods = (source: Record<string, string>) => {
      const r = resolveInvestNetwork(env(source));
      if (!r.available) throw new Error("expected devnet");
      return r.network.testPeriods;
    };
    expect(testPeriods({ NODE_ENV: "production" })).toBe(false);
    expect(
      testPeriods({
        NODE_ENV: "production",
        AROMA_V1_ALLOW_TEST_SWITCHES: "true",
      }),
    ).toBe(true);
    expect(
      testPeriods({
        NODE_ENV: "production",
        AROMA_V1_ALLOW_TEST_SWITCHES: "false",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(testPeriods({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(
      false,
    );
  });

  it("localnet only with the test switches and build flag, on loopback, with its own genesis", async () => {
    const { resolveInvestNetwork } = await load(null);
    expect(resolveInvestNetwork(env(localnet))).toMatchObject({
      available: true,
      network: { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899" },
    });
    expect(
      resolveInvestNetwork(
        env({ ...localnet, AROMA_V1_LOCALNET_GENESIS: DEVNET_GENESIS_HASH }),
      ),
    ).toMatchObject({ available: false, reason: "misconfigured" });
  });

  it("verifiedRpc refuses an RPC that reports another cluster's genesis, and an unreachable one", async () => {
    const { resolveInvestNetwork, verifiedRpc } = await load({
      cluster: "devnet",
      genesisHash: DEVNET_GENESIS_HASH,
      programId: "FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU",
      deploySignature: "x",
      fundingMint: "So11111111111111111111111111111111111111112",
    });
    const resolved = resolveInvestNetwork(env({}));
    if (!resolved.available) throw new Error("expected devnet");
    const mainnet = fakeChain({ genesis: MAINNET_GENESIS_HASH });
    await expect(
      verifiedRpc(resolved.network, mainnet.transport),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
    const devnet = fakeChain();
    await expect(
      verifiedRpc(resolved.network, devnet.transport),
    ).resolves.toBeTruthy();
    const down = fakeChain({ fail: new Set(["getGenesisHash"]) });
    await expect(
      verifiedRpc(resolved.network, down.transport),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const local = await load(null);
    const net = local.resolveInvestNetwork(env(localnet));
    if (!net.available) throw new Error("expected localnet");
    await expect(
      local.verifiedRpc(
        net.network,
        fakeChain({ genesis: DEVNET_GENESIS_HASH }).transport,
      ),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
    await expect(
      local.verifiedRpc(net.network, fakeChain({ genesis: LOCAL }).transport),
    ).resolves.toBeTruthy();
  });
});
