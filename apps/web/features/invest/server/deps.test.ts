import { stubBaseEnv } from "@/server/test/base-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/server/env";

// M9: no feature flag, so every environment needs the required variables.
beforeEach(() => stubBaseEnv());

/** Production wiring with every external client mocked (no network, no database). */
const fakeRedis = {
  set: vi.fn(async () => "OK"),
  get: vi.fn(async () => null),
  del: vi.fn(async () => 1),
  eval: vi.fn(async () => null),
  incr: vi.fn(async () => 1),
  decr: vi.fn(async () => 0),
  expire: vi.fn(async () => 1),
};
vi.mock("@/server/redis", () => ({ requireRedis: () => fakeRedis }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/features/markets/server", () => ({
  getMarkets: vi.fn(async () => ({
    state: "ok",
    data: {
      baskets: [
        {
          id: "two",
          name: "Two",
          members: [{ mint: "m", symbol: "AAPLx", weightBps: 10_000 }],
        },
      ],
    },
  })),
}));
vi.mock("@/features/creators/server", () => ({
  listPublishedBaskets: vi.fn(async () => [
    {
      id: "c1",
      name: "Creator",
      allocations: [{ mint: "m", symbol: "MSFTx", weightBps: 10_000 }],
    },
  ]),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("invest production wiring", () => {
  // The first test pays the cold dynamic import of the whole wiring graph (about 3 s alone);
  // 5 s was too tight when the full suite runs in parallel (seen as a timeout in Phase A).
  it(
    "baskets come from the markets view and published creator baskets",
    { timeout: 30_000 },
    async () => {
      const { productionServices } = await import("./deps");
      expect(await productionServices.baskets()).toEqual([
        {
          id: "two",
          name: "Two",
          kind: "curated",
          members: [{ mint: "m", symbol: "AAPLx", weightBps: 10_000 }],
        },
        {
          id: "c1",
          name: "Creator",
          kind: "creator",
          members: [{ mint: "m", symbol: "MSFTx", weightBps: 10_000 }],
        },
      ]);
    },
  );

  it("the Upstash adapter maps every command", async () => {
    const { productionServices } = await import("./deps");
    const redis = productionServices.redis();
    await redis.set("k", "v", { nx: true, ex: 5 });
    await redis.set("k", "v", { nx: true });
    await redis.set("k", "v", { ex: 5 });
    await redis.set("k", "v", {});
    await redis.get("k");
    await redis.del("k");
    await redis.eval("return 1", [], []);
    await redis.incr("n");
    await redis.decr("n");
    await redis.expire("n", 1);
    expect(fakeRedis.set.mock.calls).toEqual([
      ["k", "v", { nx: true, ex: 5 }],
      ["k", "v", { nx: true }],
      ["k", "v", { ex: 5 }],
      ["k", "v"],
    ]);
    expect(fakeRedis.expire).toHaveBeenCalledWith("n", 1);
  });

  it("devnet uses the recorded deployment (a null record is covered in cluster.test.ts); the faucet needs its key and the Turnstile secret", async () => {
    const { productionServices } = await import("./deps");
    const { V1_DEPLOYMENTS } = await import("@ovelo/guard");
    const devnet = V1_DEPLOYMENTS.devnet!;
    await expect(productionServices.context()).resolves.toMatchObject({
      network: {
        cluster: "devnet",
        deployment: {
          programId: devnet.programId,
          fundingMint: devnet.fundingMint,
          genesisHash: devnet.genesisHash,
        },
      },
    });
    expect(() => productionServices.faucet()).toThrow(
      expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }),
    );
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    resetEnvCacheForTests();
    expect(() => productionServices.faucet()).toThrow(
      expect.objectContaining({ code: "SERVICE_UNAVAILABLE" }),
    );
    vi.stubEnv(
      "OVELO_V1_FAUCET_KEYPAIR",
      JSON.stringify(Array.from({ length: 64 }, (_, i) => (i * 5) % 256)),
    );
    resetEnvCacheForTests();
    expect(productionServices.faucet()).toMatchObject({
      dailyClaims: 200,
      turnstileSecret: "1x0000000000000000000000000000000AA",
    });
    expect(productionServices.faucet().key).toHaveLength(64);
    expect(
      productionServices.clientIp(
        new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4" } }),
      ),
    ).toBe("local");
  });
});
