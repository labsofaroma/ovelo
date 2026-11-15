import { describe, expect, it, vi } from "vitest";
import { ASSOCIATED_TOKEN_PROGRAM_ID, V1_PROGRAM_ID } from "@ovelo/guard";
import type { AlertDeps } from "../alerts";
import { executePlan, type ExecuteDeps } from "../execute";
import { DLQ_KEY } from "../store";
import { fakeJupiterFetch, type BuildCall } from "../test/jupiter";
import { fakeHermes, keeperWorld, silent } from "../test/world";
import { mainnetBatchRunner } from "./batch";
import { jupiterClient } from "./jupiter";
import { assertMainnetKeeper, executeMode } from "./wiring";

async function setup(
  o: { outputs?: number; status?: number[]; fee?: number } = {},
) {
  const w = await keeperWorld({ outputs: o.outputs ?? 1 });
  const calls: BuildCall[] = [];
  const posted: unknown[] = [];
  const alerts: AlertDeps = {
    redis: w.redis,
    log: silent,
    cluster: "mainnet",
    format: "slack",
    webhookUrl: "https://hooks.example/alerts",
    fetch: vi.fn(async (_u: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return new Response("ok");
    }) as unknown as typeof fetch,
  };
  const deps: ExecuteDeps = {
    rpc: w.chain.rpc,
    keeper: w.keeper,
    db: w.db,
    redis: w.redis,
    log: silent,
    alerts,
    hermes: fakeHermes(() => BigInt(w.chain.blockTime) - 2n),
    config: {
      ...w.config,
      protocolFeeBps: o.fee ?? 0,
      feeRecipient: w.treasury.address,
    } as never,
    send: {
      priorityMicroLamports: 1_000n,
      maxAttempts: 2,
      backoffMs: 1,
      sleep: async () => {},
    },
    maxLegsPerTransaction: 2,
    runBatch: mainnetBatchRunner({
      jupiter: jupiterClient({
        baseUrl: "https://api.jup.ag",
        fetch: fakeJupiterFetch({ calls, status: o.status }),
        sleep: async () => {},
        maxAttempts: 1,
      }),
    }),
  };
  return {
    w,
    deps,
    calls,
    posted,
    run: () => executePlan(deps, w.plan, w.decode, BigInt(w.chain.blockTime)),
  };
}

describe("mainnet batch runner (fake chain)", () => {
  it("creates the swap-authority accounts, routes each leg through Jupiter, posts prices, executes, records", async () => {
    const { w, run, calls } = await setup();
    const outcome = await run();
    expect(outcome).toMatchObject({ status: "executed", period: 2 });
    // setup (ATA program) → price posts → the routed execute → cleanup
    expect(w.chain.sent[0]).toContain(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(w.chain.sent.filter((p) => p.includes(V1_PROGRAM_ID))).toHaveLength(
      1,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.amount).toBe("10000000");
    expect(w.db.receipts).toHaveLength(1);
    expect(w.state().lastExecutedPeriod).toBe(2);
  });

  it("a fee changes the routed amount to leg funding minus the fee", async () => {
    const { run, calls } = await setup({ fee: 25 });
    expect((await run()).status).toBe("executed");
    expect(calls[0]!.amount).toBe("9975000");
  });

  it("two legs: one route each", async () => {
    const { run, calls } = await setup({ outputs: 2 });
    expect((await run()).status).toBe("executed");
    expect(calls.map((c) => c.outputMint)).toHaveLength(2);
  });

  it("no Jupiter route: dead-lettered as ROUTE_UNAVAILABLE and alerted; nothing executed", async () => {
    const { w, run, posted } = await setup({ status: [400] });
    expect(await run()).toMatchObject({
      status: "dead_lettered",
      code: "ROUTE_UNAVAILABLE",
    });
    expect(w.redis.lists.get(DLQ_KEY)).toHaveLength(1);
    expect(JSON.stringify(posted)).toContain("Installment failed");
    expect(w.chain.sent.some((p) => p.includes(V1_PROGRAM_ID))).toBe(false);
  });
});

describe("mainnet wiring", () => {
  const env = {
    KEEPER_JUPITER_URL: "https://api.jup.ag",
    KEEPER_JITO_TIP_LAMPORTS: 0,
    KEEPER_MAINNET_LEGS_PER_TX: 2,
  };
  it("adds the routed runner only in the mainnet modes", () => {
    expect(executeMode({ ...env, KEEPER_CLUSTER: "devnet" })).toEqual({});
    const mainnet = executeMode({
      ...env,
      KEEPER_CLUSTER: "mainnet",
      KEEPER_JITO_URL: "https://j",
      KEEPER_JITO_TIP_LAMPORTS: 1,
    });
    expect(mainnet.maxLegsPerTransaction).toBe(2);
    expect(typeof mainnet.runBatch).toBe("function");
  });
  it("refuses a mainnet config without a keeper (decision 1)", () => {
    expect(() =>
      assertMainnetKeeper("mainnet", { keeperAuthority: { __option: "None" } }),
    ).toThrow(/keeper-only/);
    expect(() =>
      assertMainnetKeeper("devnet", { keeperAuthority: { __option: "None" } }),
    ).not.toThrow();
  });
});
