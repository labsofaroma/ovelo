import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountOnCluster,
  assertSignerCluster,
  CHAIN_ID,
  CLUSTER_LABEL,
  devnetConfig,
  DEVNET_GENESIS,
  localnetConfig,
  mainnetConfig,
  MAINNET_GENESIS,
  rpcReportsGenesis,
  storageKey,
  wrongNetworkMessage,
} from "./cluster";

const LOCAL_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const answer = (result: unknown) =>
  vi.fn(async () => Response.json({ result })) as unknown as typeof fetch;

afterEach(() => vi.unstubAllEnvs());

describe("wallet clusters (M7 B2)", () => {
  it("mainnet keeps M4's rules: devnet-only accounts are refused", () => {
    expect(accountOnCluster(["solana:devnet"], "mainnet")).toBe(false);
    expect(accountOnCluster(["solana:localnet"], "mainnet")).toBe(false);
    expect(
      accountOnCluster(["solana:mainnet", "solana:devnet"], "mainnet"),
    ).toBe(true);
    expect(accountOnCluster(undefined, "mainnet")).toBe(true);
    expect(accountOnCluster(["vendor:custom"], "mainnet")).toBe(true);
  });

  it("devnet refuses an account that declares only mainnet (and vice versa)", () => {
    expect(accountOnCluster(["solana:mainnet"], "devnet")).toBe(false);
    expect(accountOnCluster(["solana:testnet"], "devnet")).toBe(false);
    expect(accountOnCluster(["solana:devnet"], "devnet")).toBe(true);
    expect(accountOnCluster(["solana:devnet"], "localnet")).toBe(false);
    expect(accountOnCluster(["solana:localnet"], "localnet")).toBe(true);
  });

  it("the browser RPC must report the cluster's own genesis", async () => {
    expect(
      await rpcReportsGenesis(
        "https://rpc",
        DEVNET_GENESIS,
        answer(DEVNET_GENESIS),
      ),
    ).toBe(true);
    // A mainnet RPC behind a devnet page, and a devnet RPC behind a mainnet page, are refused.
    expect(
      await rpcReportsGenesis(
        "https://rpc",
        DEVNET_GENESIS,
        answer(MAINNET_GENESIS),
      ),
    ).toBe(false);
    expect(
      await rpcReportsGenesis(
        "https://rpc",
        MAINNET_GENESIS,
        answer(DEVNET_GENESIS),
      ),
    ).toBe(false);
    const offline = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await rpcReportsGenesis("https://rpc", DEVNET_GENESIS, offline),
    ).toBe(false);
  });

  it("configs carry the right genesis and default endpoints", () => {
    expect(mainnetConfig()).toMatchObject({
      cluster: "mainnet",
      genesisHash: MAINNET_GENESIS,
    });
    expect(devnetConfig()).toEqual({
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      genesisHash: DEVNET_GENESIS,
    });
    expect(devnetConfig("https://my-devnet.example").rpcUrl).toBe(
      "https://my-devnet.example",
    );
  });

  it("localnet exists only in a test build, on loopback, with a genesis of its own", () => {
    vi.stubEnv("NEXT_PUBLIC_AROMA_LOCALNET", "false");
    expect(localnetConfig("http://127.0.0.1:8899", LOCAL_GENESIS)).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_AROMA_LOCALNET", "true");
    expect(localnetConfig("http://127.0.0.1:8899", LOCAL_GENESIS)).toEqual({
      cluster: "localnet",
      rpcUrl: "http://127.0.0.1:8899",
      genesisHash: LOCAL_GENESIS,
    });
    expect(
      localnetConfig("https://api.devnet.solana.com", LOCAL_GENESIS),
    ).toBeNull();
    expect(localnetConfig("http://127.0.0.1:8899", DEVNET_GENESIS)).toBeNull();
    expect(localnetConfig("http://127.0.0.1:8899", MAINNET_GENESIS)).toBeNull();
    expect(localnetConfig("http://127.0.0.1:8899", "not-a-hash")).toBeNull();
  });

  it("no session state is shared: each cluster has its own storage key and chain id", () => {
    vi.stubEnv("NEXT_PUBLIC_AROMA_LOCALNET", "true");
    const keys = new Set(
      (["mainnet", "devnet", "localnet"] as const).map(storageKey),
    );
    expect(keys.size).toBe(3);
    expect(storageKey("mainnet")).toBe("walletName");
    expect(new Set(Object.values(CHAIN_ID)).size).toBe(3);
  });

  it("a signer made for one cluster cannot sign for another", () => {
    expect(() => assertSignerCluster(null, "devnet")).toThrow(
      /Connect a wallet/,
    );
    expect(() => assertSignerCluster({ cluster: "mainnet" }, "devnet")).toThrow(
      /devnet only/,
    );
    expect(() => assertSignerCluster({ cluster: "devnet" }, "mainnet")).toThrow(
      /mainnet only/,
    );
    expect(() =>
      assertSignerCluster({ cluster: "localnet" }, "devnet"),
    ).toThrow();
    expect(() =>
      assertSignerCluster({ cluster: "devnet" }, "devnet"),
    ).not.toThrow();
  });

  it("devnet and localnet always carry a visible test-token label; mainnet none", () => {
    expect(CLUSTER_LABEL.devnet).toBe("Devnet: test tokens, no real value");
    expect(CLUSTER_LABEL.localnet).toMatch(/no real value/);
    expect(CLUSTER_LABEL.mainnet).toBeNull();
    expect(wrongNetworkMessage("localnet")).toMatch(/local validator/);
  });
});
