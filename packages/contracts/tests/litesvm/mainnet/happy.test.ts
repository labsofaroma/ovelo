/**
 * Default (mainnet) build, real Jupiter v6 + Orca Whirlpool + xStocks binaries and pools: happy
 * paths, multi-leg across transactions, fee on and off, catch-up and skip, replay.
 */
import { describe, expect, test } from "vitest";
import type { Address } from "@solana/kit";
import * as v1 from "@aroma/guard";
import { errorCode } from "../helpers";
import { HOUR, MainnetWorld, USDC } from "./world";

const DAY = 24n * HOUR;

async function snapshot(w: MainnetWorld, plan: Address) {
  const swap = await v1.findSwapAuthorityPda();
  const ata = (
    owner: Address,
    mint: Address,
    program: Address = v1.TOKEN_2022_PROGRAM_ID,
  ) => v1.findAssociatedTokenAddress(owner, mint, program);
  const staging = await ata(plan, USDC, v1.TOKEN_PROGRAM_ID);
  const source = await ata(swap, USDC, v1.TOKEN_PROGRAM_ID);
  const transits = await Promise.all(w.stocks.map((s) => ata(swap, s.mint)));
  return () => ({
    ownerUsd: w.env.tokenAmount(w.ownerUsd),
    staging: w.env.tokenAmount(staging),
    source: w.env.tokenAmount(source),
    transits: transits.map((t) => w.env.tokenAmount(t)),
    owned: w.stocks.map((s) => w.env.tokenAmount(s.ownerAta)),
  });
}

describe("execute_installment_routed (default build, Jupiter route_v2)", () => {
  test("one leg: exact pull, delivery at or above the oracle floor, staging and swap accounts restored", async () => {
    const w = await MainnetWorld.create();
    const plan = await w.createPlan({
      stocks: [w.stocks[0]!],
      weights: [10_000],
      amount: 5_000_000n,
    });
    const read = await snapshot(w, plan);
    const before = read();
    const r = await w.execute(plan, 0, 0b1);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    const after = read();
    const [event] = v1.installmentEvents(r.logs);
    const leg = event!.legs[0]!;
    expect(before.ownerUsd - after.ownerUsd).toBe(5_000_000n);
    expect(after.staging).toBe(before.staging);
    expect(after.source).toBe(before.source);
    expect(after.transits).toEqual(before.transits);
    expect([leg.amountIn, leg.fee]).toEqual([5_000_000n, 0n]);
    expect(after.owned[0]! - before.owned[0]!).toBe(leg.amountOut);
    expect(leg.amountOut).toBeGreaterThanOrEqual(leg.minOut);
    expect(leg.minOut).toBeGreaterThan(0n);
    expect(event!.periodComplete).toBe(true);
    const p = w.plan(plan);
    expect([
      p.executedPeriods,
      p.lastExecutedPeriod,
      p.legBitmap,
      p.inProgressPeriod,
    ]).toEqual([1, 0, 0, v1.NO_PERIOD]);
    expect(
      r.logs.some((l) => l.includes("aroma-guard: jupiter route_v2 cpi")),
    ).toBe(true);
  });

  test("two legs in one transaction (the mainnet batch size: three routed legs exceed one transaction)", async () => {
    const w = await MainnetWorld.create();
    const plan = await w.createPlan();
    const read = await snapshot(w, plan);
    const before = read();
    const r = await w.execute(plan, 0, 0b011);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    const legs = v1.installmentEvents(r.logs)[0]!.legs;
    expect(legs.map((l) => l.amountIn)).toEqual([5_000_000n, 3_000_000n]);
    for (const [i, l] of legs.entries()) {
      expect(l.amountOut).toBeGreaterThanOrEqual(l.minOut);
      expect(read().owned[i]! - before.owned[i]!).toBe(l.amountOut);
    }
    expect(read().staging).toBe(before.staging + 2_000_000n); // leg 2 still in staging
    const last = await w.execute(plan, 0, 0b100);
    expect(last.ok, last.logs.join("\n")).toBe(true);
    expect(read().staging).toBe(before.staging);
  });

  test("N legs across two transactions: the leg bitmap completes the period; staging is restored only then", async () => {
    const w = await MainnetWorld.create();
    const plan = await w.createPlan();
    const read = await snapshot(w, plan);
    const start = read().staging;
    const first = await w.execute(plan, 0, 0b001);
    expect(first.ok, first.logs.join("\n")).toBe(true);
    expect(read().staging).toBe(start + 5_000_000n); // legs 1 and 2 still funded in staging
    let p = w.plan(plan);
    expect([p.legBitmap, p.inProgressPeriod, p.executedPeriods]).toEqual([
      0b001, 0, 0,
    ]);
    expect(errorCode((await w.execute(plan, 0, 0b011)).logs)).toBe(
      "InvalidLegMask",
    );
    const second = await w.execute(plan, 0, 0b110);
    expect(second.ok, second.logs.join("\n")).toBe(true);
    p = w.plan(plan);
    expect([p.legBitmap, p.executedPeriods, p.lastExecutedPeriod]).toEqual([
      0, 1, 0,
    ]);
    expect(read().staging).toBe(start);
  });

  test("fee on: taken from the leg's funding to the fee recipient; the floor is the same as with no fee", async () => {
    const off = await MainnetWorld.create();
    const on = await MainnetWorld.create({ feeBps: 25 });
    const results = [];
    for (const w of [off, on]) {
      const plan = await w.createPlan({
        stocks: [w.stocks[0]!],
        weights: [10_000],
        amount: 5_000_000n,
      });
      const fee = await v1.findAssociatedTokenAddress(
        w.feeRecipient.address,
        USDC,
        v1.TOKEN_PROGRAM_ID,
      );
      const r = await w.execute(plan, 0, 0b1);
      expect(r.ok, r.logs.join("\n")).toBe(true);
      results.push({
        leg: v1.installmentEvents(r.logs)[0]!.legs[0]!,
        fee: w.env.tokenAmount(fee),
      });
    }
    const [a, b] = results as [(typeof results)[0], (typeof results)[0]];
    expect([a.leg.fee, a.fee]).toEqual([0n, 0n]);
    expect([b.leg.fee, b.fee, b.leg.amountIn]).toEqual([
      12_500n,
      12_500n,
      4_987_500n,
    ]);
    expect(b.leg.minOut).toBe(a.leg.minOut);
    expect(b.leg.amountOut).toBeGreaterThanOrEqual(b.leg.minOut);
  });

  test("replay: a completed period cannot run again; the next one waits for its time", async () => {
    const w = await MainnetWorld.create();
    const plan = await w.createPlan({
      stocks: [w.stocks[0]!],
      weights: [10_000],
      amount: 5_000_000n,
    });
    expect((await w.execute(plan, 0, 0b1)).ok).toBe(true);
    expect(errorCode((await w.execute(plan, 0, 0b1)).logs)).toBe("NothingDue");
    w.env.setClock(w.env.now + DAY);
    expect(errorCode((await w.execute(plan, 0, 0b1)).logs)).toBe(
      "UnexpectedPeriod",
    );
    expect((await w.execute(plan, 1, 0b1)).ok).toBe(true);
  });

  test("catch-up inside the window runs the missed period first; older periods are skipped and counted", async () => {
    const w = await MainnetWorld.create();
    const plan = await w.createPlan({
      stocks: [w.stocks[0]!],
      weights: [10_000],
      amount: 5_000_000n,
      periods: 6,
    });
    const t0 = w.env.now;
    w.env.setClock(t0 + DAY + 60n); // period 1 is current; period 0 is still in the window
    expect(errorCode((await w.execute(plan, 1, 0b1)).logs)).toBe(
      "UnexpectedPeriod",
    );
    expect((await w.execute(plan, 0, 0b1)).ok).toBe(true);
    expect((await w.execute(plan, 1, 0b1)).ok).toBe(true);
    w.env.setClock(t0 + 4n * DAY + 60n); // periods 2 skipped (out of window), 3 caught up
    const r = await w.execute(plan, 3, 0b1);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    expect(v1.installmentEvents(r.logs)[0]!.newlySkipped).toBe(1);
    const p = w.plan(plan);
    expect([p.executedPeriods, p.skippedPeriods, p.lastExecutedPeriod]).toEqual(
      [3, 1, 3],
    );
  });
});
