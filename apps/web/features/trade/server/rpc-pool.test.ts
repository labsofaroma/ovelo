import { afterEach, describe, expect, it, vi } from "vitest";
import { GENESIS_HASHES } from "@/server/rpc";

const telemetry = vi.hoisted(() => ({
  alerts: [] as { stage: string; data: Record<string, unknown> }[],
  events: [] as { stage: string; data: Record<string, unknown> }[],
}));
vi.mock("@/server/telemetry", () => ({
  alertEvent: (stage: string, data: Record<string, unknown>) =>
    telemetry.alerts.push({ stage, data }),
  tradeEvent: (stage: string, data: Record<string, unknown>) =>
    telemetry.events.push({ stage, data }),
}));

const {
  COOLDOWN_MS,
  createRpcPool,
  GENESIS_TTL_MS,
  resetRpcPoolForTests,
  RpcError,
  RpcUnavailable,
} = await import("./rpc-pool");

const { network } = await import("./test-network");

const MAINNET = GENESIS_HASHES["mainnet-beta"];
const DEVNET = GENESIS_HASHES.devnet;
const PRIMARY = "https://primary.example/";
const FALLBACK = "https://fallback.example/";

const endpoints = [
  { name: "primary" as const, url: PRIMARY, genesis: MAINNET },
  { name: "fallback" as const, url: FALLBACK, genesis: MAINNET },
];
const calls = (
  log: { url: string; method: string }[],
  url: string,
  method?: string,
) =>
  log.filter((c) => c.url === url && (!method || c.method === method)).length;

afterEach(() => {
  resetRpcPoolForTests();
  telemetry.alerts.length = 0;
  telemetry.events.length = 0;
});

describe("genesis is proven per endpoint", () => {
  it("verifies each URL on its own before using it, and caches the proof for the TTL", async () => {
    let now = 1_000;
    let primaryDown = false;
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) =>
          primaryDown && m !== "getGenesisHash" ? "transport" : "ok",
      },
      [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch, now: () => now });
    await pool.rpc("getSlot");
    await pool.rpc("getSlot");
    expect(calls(net.log, PRIMARY, "getGenesisHash")).toBe(1);
    expect(calls(net.log, FALLBACK)).toBe(0);
    // The primary's proof says nothing about the fallback: it proves itself before serving.
    primaryDown = true;
    expect(await pool.rpc("getSlot")).toBe(`${FALLBACK}:getSlot`);
    const fallbackCalls = net.log
      .filter((c) => c.url === FALLBACK)
      .map((c) => c.method);
    expect(fallbackCalls).toEqual(["getGenesisHash", "getSlot"]);
    // After the TTL the proof is asked for again.
    now += GENESIS_TTL_MS + 1;
    await pool.on("fallback")!("getSlot");
    expect(calls(net.log, FALLBACK, "getGenesisHash")).toBe(2);
  });

  it("never uses a fallback on the wrong cluster, and raises an alert", async () => {
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) => (m === "getGenesisHash" ? "ok" : "transport"),
      },
      [FALLBACK]: { genesis: DEVNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch });
    await expect(
      pool.rpc("sendTransaction", ["signed"]),
    ).rejects.toBeInstanceOf(RpcUnavailable);
    expect(
      net.log.filter((c) => c.url === FALLBACK).map((c) => c.method),
    ).toEqual(["getGenesisHash"]);
    expect(telemetry.alerts).toEqual([
      { stage: "rpc.wrong_cluster", data: { rpcEndpoint: "fallback" } },
    ]);
    // Cached as refused: no second genesis call, no second alert, still never used.
    await expect(pool.on("fallback")!("getSlot")).rejects.toMatchObject({
      code: "WRONG_CLUSTER",
    });
    expect(calls(net.log, FALLBACK)).toBe(1);
    expect(telemetry.alerts).toHaveLength(1);
  });

  it("a primary on the wrong cluster stops everything (no failover around a misconfiguration)", async () => {
    const net = network({
      [PRIMARY]: { genesis: DEVNET, behave: () => "ok" },
      [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch });
    await expect(pool.rpc("getSlot")).rejects.toMatchObject({
      code: "WRONG_CLUSTER",
    });
    expect(calls(net.log, FALLBACK)).toBe(0);
  });
});

describe("which failures fail over", () => {
  it.each(["transport", "timeout", "http500", "http503", "http429"] as const)(
    "%s on the primary: the fallback serves, logged as fallback_served",
    async (failure) => {
      const net = network({
        [PRIMARY]: {
          genesis: MAINNET,
          behave: (m) => (m === "getGenesisHash" ? "ok" : failure),
        },
        [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
      });
      const pool = createRpcPool(endpoints, { fetch: net.fetch });
      expect(await pool.rpc("getSlot")).toBe(`${FALLBACK}:getSlot`);
      expect(telemetry.events).toContainEqual({
        stage: "rpc.fallback_served",
        data: { rpcEndpoint: "fallback", method: "getSlot" },
      });
      expect(pool.fallbackInUse()).toBe(true);
    },
  );

  it.each(["rpc-error", "http401-html"] as const)(
    "%s on the primary is returned as is; the fallback is never asked",
    async (failure) => {
      const net = network({
        [PRIMARY]: {
          genesis: MAINNET,
          behave: (m) => (m === "getGenesisHash" ? "ok" : failure),
        },
        [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
      });
      const pool = createRpcPool(endpoints, { fetch: net.fetch });
      const error = await pool
        .rpc("simulateTransaction", ["tx"])
        .catch((e: unknown) => e);
      if (failure === "rpc-error") expect(error).toBeInstanceOf(RpcError);
      else
        expect(error).toMatchObject({
          code: "UPSTREAM_UNAVAILABLE",
          failover: false,
        });
      expect(calls(net.log, FALLBACK)).toBe(0);
      expect(pool.fallbackInUse()).toBe(false);
    },
  );

  it("a cooling primary goes to the back of the queue, and returns after the cooldown", async () => {
    let now = 1_000;
    let primaryDown = true;
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) =>
          primaryDown && m !== "getGenesisHash" ? "transport" : "ok",
      },
      [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch, now: () => now });
    await pool.rpc("getSlot"); // primary fails, fallback serves
    const primaryBefore = calls(net.log, PRIMARY, "getSlot");
    await pool.rpc("getSlot"); // straight to the fallback
    expect(calls(net.log, PRIMARY, "getSlot")).toBe(primaryBefore);
    primaryDown = false;
    now += COOLDOWN_MS + 1;
    expect(await pool.rpc("getSlot")).toBe(`${PRIMARY}:getSlot`);
  });

  it("both down: the first failure is reported (the primary's)", async () => {
    const net = network({
      [PRIMARY]: { genesis: MAINNET, behave: () => "transport" },
      [FALLBACK]: { genesis: MAINNET, behave: () => "http503" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch });
    await expect(pool.rpc("getSlot")).rejects.toMatchObject({
      message: "mainnet RPC getGenesisHash transport failed",
    });
  });
});

describe("affinity", () => {
  it("a pinned handle sticks to the endpoint that first answered, and never switches", async () => {
    let primaryDown = false;
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) =>
          primaryDown && m !== "getGenesisHash" ? "transport" : "ok",
      },
      [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch });
    const quote = pool.pinned();
    expect(quote.endpoint()).toBeNull();
    await quote("getLatestBlockhash");
    expect(quote.endpoint()).toBe("primary");
    primaryDown = true;
    await expect(quote("simulateTransaction", ["tx"])).rejects.toBeInstanceOf(
      RpcUnavailable,
    );
    expect(calls(net.log, FALLBACK)).toBe(0);
  });

  it("before its first answer a pinned handle may fail over, then stays there", async () => {
    let primaryDown = true;
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) =>
          primaryDown && m !== "getGenesisHash" ? "transport" : "ok",
      },
      [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch });
    const quote = pool.pinned();
    expect(await quote("getLatestBlockhash")).toBe(
      `${FALLBACK}:getLatestBlockhash`,
    );
    expect(quote.endpoint()).toBe("fallback");
    primaryDown = false; // the primary recovers: the quote still reads from the fallback
    expect(await quote("simulateTransaction")).toBe(
      `${FALLBACK}:simulateTransaction`,
    );
  });

  it("on(name) reaches exactly that endpoint; null when it is not configured", async () => {
    const net = network({
      [PRIMARY]: { genesis: MAINNET, behave: () => "ok" },
      [FALLBACK]: { genesis: MAINNET, behave: () => "ok" },
    });
    const pool = createRpcPool(endpoints, { fetch: net.fetch });
    expect(await pool.on("fallback")!("getSlot")).toBe(`${FALLBACK}:getSlot`);
    expect(calls(net.log, PRIMARY)).toBe(0);
    expect(
      createRpcPool([endpoints[0]!], { fetch: net.fetch }).on("fallback"),
    ).toBeNull();
  });
});

describe("review fixes", () => {
  const one = (fetchImpl: typeof fetch) =>
    createRpcPool([endpoints[0]!], { fetch: fetchImpl });
  const genesisThen = (other: () => Response | Promise<Response>) =>
    (async (_u: unknown, init?: RequestInit) =>
      String(init?.body).includes('"getGenesisHash"')
        ? Response.json({ jsonrpc: "2.0", id: 1, result: MAINNET })
        : other()) as unknown as typeof fetch;

  it("only a JSON-RPC error with a numeric code is a refusal; anything else is not (no failover either)", async () => {
    for (const error of ["boom", { message: "no code" }, 7]) {
      resetRpcPoolForTests();
      const thrown = await one(
        genesisThen(() => Response.json({ jsonrpc: "2.0", id: 1, error })),
      )
        .rpc("sendTransaction", ["signed"])
        .catch((e: unknown) => e);
      expect(thrown).not.toBeInstanceOf(RpcError);
      expect(thrown).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        failover: false,
      });
    }
  });

  it("a reset while reading the body is a transport failure (fails over)", async () => {
    const thrown = await one(
      genesisThen(
        () =>
          new Response(
            new ReadableStream({
              start: (c) => c.error(new TypeError("terminated")),
            }),
          ),
      ),
    )
      .rpc("getSlot")
      .catch((e: unknown) => e);
    expect(thrown).toMatchObject({ failover: true });
  });

  it("a verdict is keyed by genesis AND url: the same URL under another expected genesis is checked again", async () => {
    const net = network({
      [PRIMARY]: { genesis: MAINNET, behave: () => "ok" },
    });
    await createRpcPool([endpoints[0]!], { fetch: net.fetch }).rpc("getSlot");
    const other = createRpcPool([{ ...endpoints[0]!, genesis: DEVNET }], {
      fetch: net.fetch,
    });
    await expect(other.rpc("getSlot")).rejects.toMatchObject({
      code: "WRONG_CLUSTER",
    });
    expect(calls(net.log, PRIMARY, "getGenesisHash")).toBe(2);
  });

  it("a JSON-RPC error answer from the fallback is still logged as fallback_served", async () => {
    const net = network({
      [PRIMARY]: {
        genesis: MAINNET,
        behave: (m) => (m === "getGenesisHash" ? "ok" : "transport"),
      },
      [FALLBACK]: {
        genesis: MAINNET,
        behave: (m) => (m === "getGenesisHash" ? "ok" : "rpc-error"),
      },
    });
    await expect(
      createRpcPool(endpoints, { fetch: net.fetch }).rpc(
        "simulateTransaction",
        ["tx"],
      ),
    ).rejects.toBeInstanceOf(RpcError);
    expect(telemetry.events).toContainEqual({
      stage: "rpc.fallback_served",
      data: { rpcEndpoint: "fallback", method: "simulateTransaction" },
    });
  });
});
