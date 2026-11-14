import { afterEach, describe, expect, it, vi } from "vitest";

const alerts = vi.hoisted(() => [] as unknown[]);
vi.mock("@/server/telemetry", () => ({
  alertEvent: (stage: string, data: unknown) => alerts.push({ stage, data }),
  tradeEvent: () => {},
}));
import { GENESIS_HASHES } from "@/server/rpc";
import {
  combineRpcReports,
  probeEndpoint,
  rpcEndpointsProbe,
} from "./rpc-health";
import { resetRpcPoolForTests } from "./rpc-pool";

const MAINNET = GENESIS_HASHES["mainnet-beta"];
const NOW = 1_800_000_000;

/** A node answering getGenesisHash, getSlot and getBlockTime (lag seconds behind NOW). */
function node(genesis: string, lag: number | null, down = false) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    if (down) throw new TypeError("fetch failed");
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    const result =
      method === "getGenesisHash"
        ? genesis
        : method === "getSlot"
          ? 1000
          : lag === null
            ? null
            : NOW - lag;
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  };
}
const endpoint = {
  name: "primary" as const,
  url: "https://p.example/",
  genesis: MAINNET,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRpcPoolForTests();
});

describe("probeEndpoint", () => {
  it("reports slot and lag for a mainnet node", async () => {
    expect(
      await probeEndpoint(endpoint, {
        fetch: node(MAINNET, 3) as typeof fetch,
        nowSeconds: () => NOW,
      }),
    ).toEqual({ status: "ok", slot: 1000, lagSeconds: 3 });
  });

  it("fails a node on another cluster, whatever else it answers", async () => {
    expect(
      await probeEndpoint(endpoint, {
        fetch: node(GENESIS_HASHES.devnet, 1) as typeof fetch,
        nowSeconds: () => NOW,
      }),
    ).toEqual({ status: "fail" });
    // Raised by the health check too, before any request would need the endpoint.
    expect(alerts).toContainEqual({
      stage: "rpc.wrong_cluster",
      data: { rpcEndpoint: "primary" },
    });
  });

  it("degrades a lagging node and one without a block time; fails an unreachable one", async () => {
    const opts = (f: ReturnType<typeof node>) => ({
      fetch: f as typeof fetch,
      nowSeconds: () => NOW,
    });
    expect(
      (await probeEndpoint(endpoint, opts(node(MAINNET, 30)))).status,
    ).toBe("degraded");
    expect(
      (await probeEndpoint(endpoint, opts(node(MAINNET, null)))).status,
    ).toBe("degraded");
    expect(
      (await probeEndpoint(endpoint, opts(node(MAINNET, 3, true)))).status,
    ).toBe("fail");
  });
});

describe("combineRpcReports", () => {
  it.each([
    ["ok", "skipped", "ok"],
    ["fail", "skipped", "fail"],
    ["ok", "ok", "ok"],
    ["ok", "fail", "degraded"],
    ["fail", "ok", "degraded"],
    ["degraded", "ok", "degraded"],
    ["fail", "fail", "fail"],
    ["degraded", "fail", "degraded"],
  ] as const)(
    "primary %s + fallback %s → %s",
    (primary, fallback, expected) => {
      expect(combineRpcReports({ status: primary }, { status: fallback })).toBe(
        expected,
      );
    },
  );
});

describe("rpcEndpointsProbe (configured endpoints)", () => {
  it("reports both endpoints, facts only (no URL or host)", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://primary.example");
    vi.stubEnv("SOLANA_RPC_FALLBACK_URL", "https://fallback.example");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      node(MAINNET, String(url).includes("fallback") ? 40 : 2)(url, init),
    );
    const report = await rpcEndpointsProbe({ nowSeconds: () => NOW });
    expect(report).toMatchObject({
      status: "degraded",
      primary: "ok",
      fallback: "degraded",
      fallbackInUse: false,
    });
    expect(JSON.stringify(report)).not.toMatch(/example/);
  });

  it("without a fallback, reports it as skipped", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://primary.example");
    vi.stubGlobal("fetch", node(MAINNET, 2));
    expect(await rpcEndpointsProbe({ nowSeconds: () => NOW })).toMatchObject({
      status: "ok",
      primary: "ok",
      fallback: "skipped",
    });
  });
});
