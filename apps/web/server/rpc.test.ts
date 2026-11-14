import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertDevnetRpcUrl,
  assertMainnetRpcUrl,
  type Cluster,
  type ClusterConnection,
  connectToCluster,
  GENESIS_HASHES,
} from "./rpc";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "@aroma/guard";
import {
  DEVNET_GENESIS as WALLET_DEVNET_GENESIS,
  MAINNET_GENESIS as WALLET_MAINNET_GENESIS,
} from "@/features/wallet/cluster";
import { MAINNET_GENESIS as PROD_ENV_MAINNET_GENESIS } from "./prod-env";

/** A fake JSON-RPC node: answers getGenesisHash with the given value, or fails. */
function node(genesis: string | "down") {
  const calls: string[] = [];
  const fetchImpl = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      id: number;
      method: string;
    };
    calls.push(body.method);
    if (genesis === "down") throw new TypeError("fetch failed");
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result: genesis }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  };
  return { fetchImpl, calls };
}

describe("genesis guard", () => {
  it("accepts a mainnet RPC that reports the mainnet genesis hash", async () => {
    const { fetchImpl, calls } = node(GENESIS_HASHES["mainnet-beta"]);
    const connection = await connectToCluster(
      "mainnet-beta",
      "https://rpc.example.com",
      { fetch: fetchImpl },
    );
    expect(connection.rpcEndpoint).toBe("https://rpc.example.com/");
    expect(calls).toContain("getGenesisHash");
  });

  it("accepts a devnet RPC that reports the devnet genesis hash", async () => {
    const { fetchImpl } = node(GENESIS_HASHES.devnet);
    await expect(
      connectToCluster("devnet", "https://devnet.rpc.example.com", {
        fetch: fetchImpl,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a devnet connection that reports the MAINNET genesis hash", async () => {
    const { fetchImpl } = node(GENESIS_HASHES["mainnet-beta"]);
    await expect(
      connectToCluster("devnet", "https://devnet.rpc.example.com", {
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
  });

  it("rejects a mainnet connection that reports the DEVNET genesis hash", async () => {
    const { fetchImpl } = node(GENESIS_HASHES.devnet);
    await expect(
      connectToCluster("mainnet-beta", "https://rpc.example.com", {
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
  });

  it("rejects an unknown genesis hash (e.g. testnet or a local validator)", async () => {
    const { fetchImpl } = node("4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY");
    await expect(
      connectToCluster("devnet", "https://x.example.com", { fetch: fetchImpl }),
    ).rejects.toMatchObject({
      code: "WRONG_CLUSTER",
    });
    await expect(
      connectToCluster("mainnet-beta", "https://x.example.com", {
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "WRONG_CLUSTER",
    });
  });

  it("reports an unreachable RPC as UPSTREAM_UNAVAILABLE, not as a cluster pass", async () => {
    const { fetchImpl } = node("down");
    await expect(
      connectToCluster("mainnet-beta", "https://rpc.example.com", {
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("does not leak the endpoint or error text in the public message", async () => {
    const { fetchImpl } = node(GENESIS_HASHES.devnet);
    const error = await connectToCluster(
      "mainnet-beta",
      "https://rpc.example.com/?api-key=SECRETKEY",
      {
        fetch: fetchImpl,
      },
    ).catch((e: unknown) => e);
    expect(
      JSON.stringify((error as { publicMessage: string }).publicMessage),
    ).not.toMatch(/SECRETKEY|rpc\.example/);
  });
});

describe("cluster brand", () => {
  it("is not interchangeable at compile time", () => {
    expectTypeOf<ClusterConnection<"devnet">>().not.toEqualTypeOf<
      ClusterConnection<"mainnet-beta">
    >();
    expectTypeOf<ClusterConnection<"devnet">>().not.toMatchTypeOf<
      ClusterConnection<"mainnet-beta">
    >();
    expectTypeOf<Cluster>().toEqualTypeOf<"mainnet-beta" | "devnet">();
  });
});

describe("endpoint policy", () => {
  it("mainnet requires dedicated HTTPS and refuses devnet/testnet-looking endpoints", () => {
    expect(assertMainnetRpcUrl("https://rpc.example.com/key")).toContain(
      "https://",
    );
    expect(() => assertMainnetRpcUrl("http://rpc.example.com")).toThrow();
    expect(() =>
      assertMainnetRpcUrl("https://api.devnet.solana.com"),
    ).toThrow();
    expect(() =>
      assertMainnetRpcUrl("https://x.example.com/testnet"),
    ).toThrow();
    expect(() =>
      assertMainnetRpcUrl("https://user:pw@rpc.example.com"),
    ).toThrow();
    expect(() => assertMainnetRpcUrl("not a url")).toThrow();
  });

  it("devnet allows HTTPS, or HTTP only on loopback", () => {
    expect(assertDevnetRpcUrl("https://api.devnet.solana.com")).toContain(
      "devnet",
    );
    expect(assertDevnetRpcUrl("http://127.0.0.1:8899")).toContain("8899");
    expect(() => assertDevnetRpcUrl("http://rpc.example.com")).toThrow();
    expect(() =>
      assertDevnetRpcUrl("https://user:pw@rpc.example.com"),
    ).toThrow();
  });
});

describe("genesis hashes: pinned, and every v1 copy agrees", () => {
  // The cluster identities themselves (AGENTS.md rule 3), written out here so a typo in any copy
  // cannot also change the expectation. M9 Step 1: these used to be read from prototype files.
  const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  const DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

  it("server/rpc.ts names the real clusters", () => {
    expect(GENESIS_HASHES["mainnet-beta"]).toBe(MAINNET);
    expect(GENESIS_HASHES.devnet).toBe(DEVNET);
  });

  it("the Guard client (shared with the keeper), the wallet and the prod-env check agree", () => {
    expect(MAINNET_GENESIS_HASH).toBe(MAINNET);
    expect(DEVNET_GENESIS_HASH).toBe(DEVNET);
    expect(WALLET_MAINNET_GENESIS).toBe(MAINNET);
    expect(WALLET_DEVNET_GENESIS).toBe(DEVNET);
    expect(PROD_ENV_MAINNET_GENESIS).toBe(MAINNET);
  });

  it("the mint-precision resolver (private constant) checks the mainnet genesis", () => {
    const source = readFileSync(
      new URL("../lib/sdk/core/mint-precision.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(`MAINNET_GENESIS_HASH = "${MAINNET}"`);
  });
});
