import { afterEach, describe, expect, it, vi } from "vitest";
import { GENESIS_HASHES } from "@/server/rpc";
import { signer } from "@/server/test/transactions";
import { createJitoRpc, jitoEndpoint, prepareJitoTip } from "./bundle";
import {
  fetchJupiterBuild,
  jupiterBase,
  resetJupiterPoolForTests,
} from "./jupiter";
import {
  assertMainnet,
  latestBlockhash,
  mainnetRpc,
  RpcError,
  simulateTransaction,
} from "./rpc";
import { redisTradeStore, type TradeRecord } from "./store";

/** Transport adapters with `fetch` stubbed: no network, no keys. */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetJupiterPoolForTests();
});

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), { status, headers });

describe("mainnetRpc", () => {
  it("posts JSON-RPC to SOLANA_RPC_URL and returns the result", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    const fetchSpy = vi.fn(async () =>
      json({ result: GENESIS_HASHES["mainnet-beta"] }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await expect(assertMainnet()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://rpc.example.test/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps a JSON-RPC error to RpcError and transport failures to UPSTREAM_UNAVAILABLE", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    vi.stubGlobal("fetch", async () => json({ error: { message: "nope" } }));
    await expect(mainnetRpc("getSlot")).rejects.toBeInstanceOf(RpcError);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    await expect(mainnetRpc("getSlot")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 502 }));
    await expect(mainnetRpc("getSlot")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    vi.stubGlobal("fetch", async () => json({}, 500));
    await expect(mainnetRpc("getSlot")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("latestBlockhash and simulateTransaction map results and failures", async () => {
    const rpc = async <T>(method: string): Promise<T> =>
      (method === "getLatestBlockhash"
        ? { value: { blockhash: "b", lastValidBlockHeight: 9 } }
        : {
            value: {
              err: { InstructionError: [0, "InsufficientFunds"] },
              logs: [],
            },
          }) as T;
    expect(await latestBlockhash(rpc)).toEqual({
      blockhash: "b",
      lastValidBlockHeight: 9,
    });
    await expect(simulateTransaction("tx", ["a"], rpc)).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
      publicMessage: expect.stringMatching(/insufficient funds/),
    });
    const ok = async <T>(): Promise<T> =>
      ({ value: { err: null, unitsConsumed: 5, accounts: [null] } }) as T;
    expect(await simulateTransaction("tx", [], ok)).toEqual({
      accounts: [null],
      unitsConsumed: 5,
    });
  });
});

describe("Jupiter build", () => {
  const params = new URLSearchParams({
    inputMint: "a",
    outputMint: "b",
    amount: "1",
  });

  it("sends the API key, widens maxAccounts only on 'no route', and stops on other errors", async () => {
    vi.stubEnv("JUPITER_API_KEY", "k1");
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push(new URL(url).searchParams.get("maxAccounts")!);
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k1");
      return seen.length < 3
        ? json({ errorCode: "NO_ROUTES_FOUND" }, 400)
        : json({ ok: true });
    });
    const response = await fetchJupiterBuild(params);
    expect(response.ok).toBe(true);
    expect(seen).toEqual(["32", "40", "48"]);
    seen.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(new URL(url).searchParams.get("maxAccounts")!);
      return json({ errorCode: "TOKEN_NOT_TRADABLE" }, 400);
    });
    expect((await fetchJupiterBuild(params)).status).toBe(400);
    expect(seen).toEqual(["32"]);
  });

  it("keyless production is unavailable; a 429 becomes RATE_LIMITED; transport errors are upstream", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JUPITER_API_KEY", "");
    await expect(fetchJupiterBuild(params)).rejects.toMatchObject({
      code: "TRADING_UNAVAILABLE",
    });
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal("fetch", async () => json({}, 429, { "retry-after": "1" }));
    await expect(fetchJupiterBuild(params)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    await expect(fetchJupiterBuild(params)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("the loopback stand-in is used only while test switches are allowed", () => {
    vi.stubEnv("AROMA_V1_TEST_JUPITER_URL", "http://127.0.0.1:4010");
    expect(jupiterBase()).toBe("http://127.0.0.1:4010");
    vi.stubEnv("NODE_ENV", "production");
    expect(jupiterBase()).toBe("https://api.jup.ag");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AROMA_V1_TEST_JUPITER_URL", "https://evil.example");
    expect(jupiterBase()).toBe("https://api.jup.ag");
  });
});

describe("Jito transport", () => {
  it("is disabled without JITO_BLOCK_ENGINE_URL and prepares a capped tip to a known account", async () => {
    vi.stubEnv("JITO_BLOCK_ENGINE_URL", "");
    expect(jitoEndpoint()).toBeNull();
    vi.stubEnv("JITO_AUTH_UUID", "uuid");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("tip_floor"))
        return json([{ ema_landed_tips_50th_percentile: 0.00002 }]);
      expect((init?.headers as Record<string, string>)["x-jito-auth"]).toBe(
        "uuid",
      );
      return json({ result: ["96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"] });
    });
    const jito = createJitoRpc("https://jito.example.test/api/v1/bundles");
    const tip = await prepareJitoTip(signer.publicKey.toBase58(), jito);
    expect(tip.lamports).toBe(20_000);
    vi.stubGlobal("fetch", async () => json({ error: { message: "x" } }));
    await expect(jito("sendBundle")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    vi.stubGlobal("fetch", async () => json({}, 500));
    await expect(jito("sendBundle")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});

describe("redisTradeStore", () => {
  it("claims with SET NX + TTL, returns the existing record on replay", async () => {
    const data = new Map<string, string>();
    const redis = {
      set: vi.fn(
        async (k: string, v: string, o: { nx?: boolean; ex: number }) => {
          expect(o.ex).toBe(7 * 24 * 3600);
          if (o.nx && data.has(k)) return null;
          data.set(k, v);
          return "OK";
        },
      ),
      get: vi.fn(async (k: string) => data.get(k) ?? null),
    };
    const store = redisTradeStore(redis as never);
    const record = { id: "a", status: "submitting" } as TradeRecord;
    expect(await store.claim(record)).toBeNull();
    expect(await store.claim({ ...record, status: "pending" })).toMatchObject({
      status: "submitting",
    });
    await store.save({ ...record, status: "confirmed" });
    expect((await store.get("a"))?.status).toBe("confirmed");
    expect(await store.get("missing")).toBeNull();
  });
});
