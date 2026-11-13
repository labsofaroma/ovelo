import { Keypair, SystemProgram } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENESIS_HASHES } from "@/server/rpc";
import {
  assertMainnet,
  mainnetEndpoint,
  mainnetV1Active,
  selectTransactionVersion,
  type MainnetRpc,
} from "./rpc";

/** Ported from the V1-gating tests in tests/composed-transactions.test.ts. */
const FEATURE_OWNER = "Feature111111111111111111111111111111111111";

function fakeRpc(state: {
  genesis?: string;
  owner?: string;
  activeSlot?: number;
  active?: boolean;
  slot?: number;
  offline?: boolean;
}): MainnetRpc & { calls: string[] } {
  const calls: string[] = [];
  const rpc = async <T>(method: string): Promise<T> => {
    calls.push(method);
    if (state.offline) throw new Error("offline");
    const bytes = Buffer.alloc(9);
    bytes[0] = state.active === false ? 0 : 1;
    bytes.writeBigUInt64LE(BigInt(state.activeSlot ?? 10), 1);
    if (method === "getGenesisHash")
      return (state.genesis ?? GENESIS_HASHES["mainnet-beta"]) as T;
    if (method === "getSlot") return (state.slot ?? 20) as T;
    return {
      value: {
        owner: state.owner ?? FEATURE_OWNER,
        data: [bytes.toString("base64"), "base64"],
      },
    } as T;
  };
  return Object.assign(rpc, { calls });
}

describe("V1 activation", () => {
  it("requires a correctly owned, activated feature account", async () => {
    expect(await mainnetV1Active(fakeRpc({}))).toBe(true);
    expect(await mainnetV1Active(fakeRpc({ activeSlot: 21 }))).toBe(false);
    expect(
      await mainnetV1Active(
        fakeRpc({ owner: SystemProgram.programId.toBase58() }),
      ),
    ).toBe(false);
    expect(await mainnetV1Active(fakeRpc({ offline: true }))).toBe(false);
  });

  it("chooses V1 only with wallet capability and live activation, otherwise an honest V0 fallback", async () => {
    const v0Only = fakeRpc({});
    expect(await selectTransactionVersion([0], v0Only)).toBe(0);
    expect(v0Only.calls).not.toContain("getAccountInfo");
    expect(await selectTransactionVersion([0, 1], fakeRpc({}))).toBe(1);
    expect(
      await selectTransactionVersion([0, 1], fakeRpc({ active: false })),
    ).toBe(0);
    await expect(
      selectTransactionVersion([1], fakeRpc({ active: false })),
    ).rejects.toMatchObject({ code: "WALLET_UNSUPPORTED" });
    await expect(
      selectTransactionVersion([], fakeRpc({})),
    ).rejects.toMatchObject({ code: "WALLET_UNSUPPORTED" });
    await expect(
      selectTransactionVersion(
        [0, 1],
        fakeRpc({ genesis: Keypair.generate().publicKey.toBase58() }),
      ),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
  });

  it("assertMainnet refuses another cluster's genesis", async () => {
    await expect(
      assertMainnet(fakeRpc({ genesis: GENESIS_HASHES.devnet })),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
    await expect(assertMainnet(fakeRpc({}))).resolves.toBeUndefined();
  });
});

describe("mainnet endpoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses SOLANA_RPC_URL with the mainnet genesis and refuses devnet-looking URLs", () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    expect(mainnetEndpoint()).toEqual({
      url: "https://rpc.example.test/",
      genesis: GENESIS_HASHES["mainnet-beta"],
      fork: false,
    });
    vi.stubEnv("SOLANA_RPC_URL", "https://api.devnet.solana.com");
    expect(() => mainnetEndpoint()).toThrow();
  });

  it("a local fork is honoured only with test switches allowed and a loopback URL", () => {
    vi.stubEnv("SOLANA_RPC_URL", "http://127.0.0.1:8899");
    vi.stubEnv("AROMA_V1_TEST_FORK_GENESIS", GENESIS_HASHES.devnet);
    vi.stubEnv("NODE_ENV", "test");
    expect(mainnetEndpoint()).toMatchObject({ fork: true });
    vi.stubEnv("NODE_ENV", "production");
    expect(() => mainnetEndpoint()).toThrow();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    // A fork genesis never applies to a non-loopback endpoint: mainnet rules hold.
    expect(mainnetEndpoint()).toMatchObject({
      fork: false,
      genesis: GENESIS_HASHES["mainnet-beta"],
    });
  });
});
