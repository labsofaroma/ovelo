import { NO_PERIOD } from "@aroma/guard";
import { getInstallmentExecutedEventEncoder } from "@aroma/guard/generated";
import { describe, expect, it } from "vitest";
import { listPlans } from "./plans";
import { memoryInvestStore } from "./store";
import { planAccount, programLogs, world } from "./test-world";

const PDA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const START = 1_763_000_000n;
const WEEK = 604_800n;

function installment(
  plan: string,
  mint: string,
  period: number,
  newlySkipped: number,
) {
  return Uint8Array.from(
    getInstallmentExecutedEventEncoder().encode({
      plan: plan as never,
      period,
      newlySkipped,
      periodComplete: true,
      legs: [
        {
          leg: 0,
          mint: mint as never,
          amountIn: 10_000_000n,
          fee: 0n,
          amountOut: 4_321n,
          minOut: 4_200n,
          oraclePrice: 23_142_000_000n,
          oracleExpo: -8,
          oraclePublishTime: START + 100n,
          multiplierFp: 1_000_000_000_000n,
        },
      ],
    }),
  );
}

describe("listPlans", () => {
  it("reads plans from chain, repairs the index (missing and orphan rows) and builds the timeline", async () => {
    const w = await world();
    // Periods 0 and 2 executed, 1 skipped (window 1); now is in period 3, which is due.
    w.chain.blockTime = Number(START + 3n * WEEK + 60n);
    w.chain.accounts.set(
      PDA,
      planAccount({
        owner: w.owner.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
        startsAt: START,
        periodSeconds: WEEK,
        lastExecutedPeriod: 2,
        executedPeriods: 2,
        skippedPeriods: 1,
      }),
    );
    const store = memoryInvestStore();
    await store.upsertRows([
      {
        pda: "orphan",
        owner: w.owner.address,
        fundingMint: w.usd.address,
        nonce: "9",
        status: "active",
        nextDueAt: 1n,
        lastPeriod: null,
        skippedPeriods: 0,
        executedPeriods: 0,
        periods: 1,
      },
    ]);
    // Receipts are missing: the timeline must backfill them from chain history.
    w.chain.signatures.set(PDA, [
      { signature: "sigP2".padEnd(88, "2"), err: null },
      { signature: "sigP0".padEnd(88, "0"), err: null },
    ]);
    w.chain.transactions.set("sigP2".padEnd(88, "2"), {
      logs: programLogs(installment(PDA, w.aapl.address, 2, 1)),
    });
    w.chain.transactions.set("sigP0".padEnd(88, "0"), {
      logs: programLogs(installment(PDA, w.aapl.address, 0, 0)),
    });
    const result = await listPlans(
      { network: w.network, rpc: w.chain.rpc, store },
      w.owner.address,
    );
    expect(result).toMatchObject({
      cluster: "devnet",
      available: true,
      asOf: (START + 3n * WEEK + 60n).toString(),
    });
    const [plan] = result.plans;
    expect(plan!.timeline.map((e) => [e.status, e.recordedOnChain])).toEqual([
      ["executed", true],
      ["skipped", true],
      ["executed", true],
      ["due", false],
    ]);
    expect(plan!.timelineComplete).toBe(true);
    expect(plan!.timeline[2]!.executions[0]!.legs[0]).toMatchObject({
      symbol: "AAPL",
      amountOut: "4321",
      oraclePrice: "23142000000",
      oracleExpo: -8,
    });
    expect(plan!.outputs).toEqual([
      { mint: w.aapl.address, symbol: "AAPL", weightBps: 10_000 },
    ]);
    expect(store.rows.get("orphan")?.status).toBe("closed");
    expect(store.rows.get(PDA)).toMatchObject({
      executedPeriods: 2,
      skippedPeriods: 1,
      lastPeriod: 2,
    });
    expect([...store.receipts.values()].map((r) => r.period).sort()).toEqual([
      0, 2,
    ]);
    // A second read needs no history: receipts are cached.
    const before = w.chain.calls.filter(
      (c) => c.method === "getSignaturesForAddress",
    ).length;
    await listPlans(
      { network: w.network, rpc: w.chain.rpc, store },
      w.owner.address,
    );
    expect(
      w.chain.calls.filter((c) => c.method === "getSignaturesForAddress")
        .length,
    ).toBe(before);
  });

  it("says when settled periods are not indexed yet instead of guessing", async () => {
    const w = await world();
    w.chain.blockTime = Number(START + WEEK + 10n);
    w.chain.accounts.set(
      PDA,
      planAccount({
        owner: w.owner.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
        startsAt: START,
        periodSeconds: WEEK,
        lastExecutedPeriod: 0,
        executedPeriods: 1,
      }),
    );
    const result = await listPlans(
      { network: w.network, rpc: w.chain.rpc, store: memoryInvestStore() },
      w.owner.address,
    );
    expect(result.plans[0]!.timelineComplete).toBe(false);
    expect(result.plans[0]!.timeline[0]!.status).toBe("unindexed");
  });

  it("other owners' plans are never listed; an empty owner has no plans", async () => {
    const w = await world();
    w.chain.accounts.set(
      PDA,
      planAccount({
        owner: w.keeper.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
        lastExecutedPeriod: NO_PERIOD,
      }),
    );
    const result = await listPlans(
      { network: w.network, rpc: w.chain.rpc, store: memoryInvestStore() },
      w.owner.address,
    );
    expect(result.plans).toEqual([]);
  });
});
