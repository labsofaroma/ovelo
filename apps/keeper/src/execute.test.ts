import { ASSOCIATED_TOKEN_PROGRAM_ID, V1_PROGRAM_ID } from "@aroma/guard";
import { PYTH_RECEIVER_ID, WORMHOLE_PROGRAM_ID } from "@aroma/guard/pyth";
import { describe, expect, it, vi } from "vitest";
import type { AlertDeps } from "./alerts";
import { executePlan, type ExecuteDeps } from "./execute";
import { acquireLease, DLQ_KEY } from "./store";
import { fakeHermes, keeperWorld, silent } from "./test/world";

async function setup(
  options: Parameters<typeof keeperWorld>[0] = {},
  hermesFailure?: Error,
) {
  const w = await keeperWorld(options);
  const posted: unknown[] = [];
  const alerts: AlertDeps = {
    redis: w.redis,
    log: silent,
    cluster: "devnet",
    format: "slack",
    webhookUrl: "https://hooks.example/alerts",
    fetch: vi.fn(async (_url: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return new Response("ok");
    }) as unknown as typeof fetch,
  };
  const hermes = fakeHermes(
    () => BigInt(w.chain.blockTime) - 2n,
    hermesFailure,
  );
  const deps: ExecuteDeps = {
    rpc: w.chain.rpc,
    keeper: w.keeper,
    db: w.db,
    redis: w.redis,
    log: silent,
    alerts,
    hermes,
    config: w.config as never,
    send: {
      priorityMicroLamports: 0n,
      maxAttempts: 3,
      backoffMs: 1,
      sleep: async () => {},
    },
  };
  const run = () =>
    executePlan(deps, w.plan, w.decode, BigInt(w.chain.blockTime));
  return { w, deps, run, posted, hermes };
}

const kinds = (posted: unknown[]) =>
  posted.map((p) => String((p as { text: string }).text).split(" ")[3]);

describe("executePlan", () => {
  it("runs the oldest runnable period: token accounts, VAA, one post per feed, execute, cleanup; receipt and index", async () => {
    const { w, run } = await setup({ lastExecutedPeriod: 2 });
    const outcome = await run();
    expect(outcome).toMatchObject({
      status: "executed",
      period: 3,
      newlySkipped: 0,
    });
    expect(
      w.chain.sent.map((programs) =>
        programs.filter((p) => !p.startsWith("ComputeBudget")),
      ),
    ).toEqual([
      [ASSOCIATED_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID],
      expect.arrayContaining([WORMHOLE_PROGRAM_ID]),
      [PYTH_RECEIVER_ID],
      [V1_PROGRAM_ID],
      expect.arrayContaining([WORMHOLE_PROGRAM_ID, PYTH_RECEIVER_ID]),
    ]);
    expect(
      w.chain.calls.filter((c) => c.method === "simulateTransaction").length,
    ).toBeGreaterThanOrEqual(w.chain.sent.length);
    expect(w.db.receipts).toEqual([
      expect.objectContaining({
        planPda: w.plan,
        period: 3,
        wallet: w.owner.address,
        amountIn: "1000000",
        mintIn: w.usd.address,
      }),
    ]);
    expect(w.db.rows.get(w.plan)).toMatchObject({
      lastPeriod: 3,
      executedPeriods: 4,
    });
    expect(w.redis.store.has(`lease:plan:${w.plan}:3`)).toBe(false);
  });

  it("a missed period is recorded as skipped by the catch-up execution, and alerted once", async () => {
    const { w, run, posted } = await setup({ lastExecutedPeriod: 0 });
    const outcome = await run();
    expect(outcome).toMatchObject({
      status: "executed",
      period: 2,
      newlySkipped: 1,
    });
    expect(w.state().skippedPeriods).toBe(1);
    expect(kinds(posted)).toEqual(["installment_skipped:"]);
    expect(JSON.stringify(posted[0])).toMatch(/periods: 1/);
  });

  it("legs run in batches of at most three, each with its leg mask", async () => {
    const { w, run } = await setup({ outputs: 4, lastExecutedPeriod: 2 });
    expect(await run()).toMatchObject({ status: "executed", period: 3 });
    expect(w.executed).toEqual([
      { period: 3, legMask: 0b0111 },
      { period: 3, legMask: 0b1000 },
    ]);
    expect(w.db.receipts.map((r) => r.period)).toEqual([3, 3]);
  });

  it("lease contention: a period another run holds is left alone", async () => {
    const { w, run } = await setup({ lastExecutedPeriod: 2 });
    await acquireLease(w.redis, w.plan, 3, 60_000);
    expect(await run()).toEqual({
      status: "lease_held",
      plan: w.plan,
      period: 3,
    });
    expect(w.chain.sent).toEqual([]);
  });

  it("stale or unreachable Hermes defers the installment and alerts; nothing is sent after the token accounts", async () => {
    const { w, run, posted, hermes } = await setup({ lastExecutedPeriod: 2 });
    (hermes as { latestUpdates: unknown }).latestUpdates = fakeHermes(
      () => BigInt(w.chain.blockTime) - 3_600n,
    ).latestUpdates;
    expect(await run()).toMatchObject({ status: "deferred", reason: "stale" });
    expect(kinds(posted)).toEqual(["hermes_unavailable:"]);
    expect(w.chain.sent.some((p) => p.includes(V1_PROGRAM_ID))).toBe(false);
    const down = await setup(
      { lastExecutedPeriod: 2 },
      new Error("connect ECONNREFUSED"),
    );
    expect(await down.run()).toMatchObject({
      status: "deferred",
      reason: "unreachable",
    });
  });

  it("a program refusal in simulation is permanent: dead-lettered with its code, alerted, lease released", async () => {
    const { w, run, posted } = await setup({ lastExecutedPeriod: 2 });
    // One simulation per transaction: token accounts, VAA, post, then execute fails.
    w.chain.simulations.push(
      { err: null },
      { err: null },
      { err: null },
      {
        err: { InstructionError: [2, { Custom: 6012n }] },
        logs: ["Program log: Error: UnexpectedPeriod"],
      },
    );
    const outcome = await run();
    expect(outcome).toMatchObject({
      status: "dead_lettered",
      period: 3,
      code: "PROGRAM_ERROR",
    });
    const [entry] = (w.redis.lists.get(DLQ_KEY) ?? []).map(
      (raw) => JSON.parse(raw) as Record<string, unknown>,
    );
    expect(entry).toMatchObject({
      plan: w.plan,
      period: 3,
      legMask: 1,
      code: "PROGRAM_ERROR",
      attempts: 1,
    });
    expect(kinds(posted)).toEqual(["installment_failed:"]);
    expect(w.redis.store.has(`lease:plan:${w.plan}:3`)).toBe(false);
  });

  it("transient send failures retry with backoff; exhausting them dead-letters RETRIES_EXHAUSTED", async () => {
    const ok = await setup({ lastExecutedPeriod: 2 });
    ok.w.chain.sendFailures = 2;
    expect(await ok.run()).toMatchObject({ status: "executed" });
    const bad = await setup({ lastExecutedPeriod: 2 });
    bad.w.chain.sendFailures = 99;
    expect(await bad.run()).toMatchObject({
      status: "dead_lettered",
      code: "RETRIES_EXHAUSTED",
    });
  });

  it("paused, not due, and closed plans do nothing (and the index follows the chain)", async () => {
    const paused = await setup({ lastExecutedPeriod: 2 });
    paused.w.setState({ pausedByOwner: true });
    expect(await paused.run()).toMatchObject({ status: "paused" });
    const done = await setup({ lastExecutedPeriod: 3 });
    expect(await done.run()).toMatchObject({ status: "not_due" });
    const gone = await setup({ lastExecutedPeriod: 2 });
    gone.w.db.rows.set(gone.w.plan, {
      pda: gone.w.plan,
      owner: "o",
      fundingMint: "m",
      nonce: "1",
      status: "active",
      nextDueAt: 1n,
      lastPeriod: 2,
      skippedPeriods: 0,
      executedPeriods: 3,
      periods: 6,
    });
    gone.w.chain.accounts.delete(gone.w.plan);
    expect(await gone.run()).toMatchObject({ status: "not_due", period: null });
    expect(gone.w.db.rows.get(gone.w.plan)?.status).toBe("closed");
  });
});
