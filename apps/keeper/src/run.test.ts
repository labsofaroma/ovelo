import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "@ovelo/guard";
import { describe, expect, it, vi } from "vitest";
import { parseKeeperEnv } from "./env";
import { runOnce, type RunDeps } from "./run";
import { pushDeadLetter } from "./store";
import { fakeHermes, keeperWorld, silent } from "./test/world";

async function setup(options: Parameters<typeof keeperWorld>[0] = {}) {
  const w = await keeperWorld(options);
  const secret = JSON.stringify(w.keeperSecret);
  const env = parseKeeperEnv({
    KEEPER_KEYPAIR: secret,
    QSTASH_CURRENT_SIGNING_KEY: "sig_current_xxxxxxxxxxxxxxxx",
    QSTASH_NEXT_SIGNING_KEY: "sig_next_yyyyyyyyyyyyyyyyyyy",
    UPSTASH_REDIS_REST_URL: "https://redis.example.com",
    UPSTASH_REDIS_REST_TOKEN: "t",
    DATABASE_URL: "postgres://u:p@db.example.com/a",
    KEEPER_MIN_SOL_LAMPORTS: "1000000000",
  });
  const posted: string[] = [];
  const deps: RunDeps = {
    env,
    db: w.db,
    redis: w.redis,
    log: silent,
    transport: w.chain.transport,
    sleep: async () => {},
    hermes: fakeHermes(() => BigInt(w.chain.blockTime) - 1n),
    alerts: {
      cluster: "devnet",
      format: "slack",
      webhookUrl: "https://hooks.example/a",
      fetch: vi.fn(async (_u: string, init: RequestInit) => {
        posted.push(String(JSON.parse(String(init.body)).text));
        return new Response("ok");
      }) as unknown as typeof fetch,
    },
  };
  return { w, deps, posted };
}

describe("runOnce", () => {
  it("reconciles from chain, executes the due plan, and reports balance and dead-letter alerts", async () => {
    const { w, deps, posted } = await setup({ lastExecutedPeriod: 2 });
    w.chain.balance = 100_000_000n;
    await pushDeadLetter(w.redis, {
      plan: w.plan,
      period: 0,
      legMask: 1,
      code: "X",
      error: "e",
      attempts: 3,
    });
    const report = await runOnce(deps);
    expect(report.reconciled.drift).toBe(1); // the plan was on chain but not indexed
    expect(report.outcomes).toEqual([
      expect.objectContaining({ status: "executed", plan: w.plan, period: 3 }),
    ]);
    expect(report.deadLetters).toBe(1);
    expect(posted.map((t) => t.split(" ")[3])).toEqual([
      "keeper_balance_low:",
      "dead_letter_growth:",
    ]);
    expect(w.db.receipts).toHaveLength(1);
    // Next run: nothing new, no repeated alerts.
    posted.length = 0;
    const again = await runOnce(deps);
    expect(again.outcomes).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("refuses a mainnet (or any other) genesis before reading anything, and alerts", async () => {
    const { w, deps, posted } = await setup();
    w.chain.genesis = MAINNET_GENESIS_HASH;
    await expect(runOnce(deps)).rejects.toThrow(/expected cluster/);
    expect(posted[0]).toMatch(/rpc_degraded/);
    expect(w.chain.calls.map((c) => c.method)).toEqual(["getGenesisHash"]);
    expect(DEVNET_GENESIS_HASH).not.toBe(MAINNET_GENESIS_HASH);
  });

  it("refuses to run with a key that is not the configured keeper_authority", async () => {
    const other = await keeperWorld();
    const { deps } = await setup({ keeperAuthority: other.keeper.address });
    await expect(runOnce(deps)).rejects.toThrow(/keeper_authority/);
  });
});
