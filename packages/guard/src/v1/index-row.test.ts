import { describe, expect, test } from "vitest";
import { NO_PERIOD } from "./constants";
import {
  diffPlanIndex,
  indexRowFromPlan,
  type PlanIndexRow,
} from "./index-row";
import { k, plan } from "./test/fixtures";

const P = 100n;
const base = (overrides = {}) =>
  plan({
    startsAt: 1_000n,
    periodSeconds: P,
    periods: 4,
    catchUpWindowPeriods: 1,
    ...overrides,
  });

describe("indexRowFromPlan", () => {
  test("a due plan is due now; a waiting plan is due when its next period opens", () => {
    const due = indexRowFromPlan(
      k(6),
      base({ lastExecutedPeriod: NO_PERIOD }),
      1_050n,
    );
    expect(due).toMatchObject({
      status: "active",
      nextDueAt: 1_050n,
      lastPeriod: null,
    });
    const waiting = indexRowFromPlan(
      k(6),
      base({ lastExecutedPeriod: 0, executedPeriods: 1 }),
      1_050n,
    );
    expect(waiting).toMatchObject({
      status: "active",
      nextDueAt: 1_100n,
      lastPeriod: 0,
    });
    expect(indexRowFromPlan(k(6), base(), 900n).nextDueAt).toBe(1_000n);
  });

  test("paused and finished plans have nothing due", () => {
    expect(
      indexRowFromPlan(k(6), base({ pausedByOwner: true }), 1_050n),
    ).toMatchObject({
      status: "paused",
      nextDueAt: null,
    });
    const done = indexRowFromPlan(
      k(6),
      base({ lastExecutedPeriod: 3, executedPeriods: 3, skippedPeriods: 1 }),
      1_500n,
    );
    expect(done).toMatchObject({
      status: "completed",
      nextDueAt: null,
      executedPeriods: 3,
    });
  });
});

describe("diffPlanIndex", () => {
  const row = (
    pda: string,
    over: Partial<PlanIndexRow> = {},
  ): PlanIndexRow => ({
    pda,
    owner: "owner-a",
    fundingMint: "usd",
    nonce: "1",
    status: "active",
    nextDueAt: 10n,
    lastPeriod: null,
    skippedPeriods: 0,
    executedPeriods: 0,
    periods: 4,
    ...over,
  });

  test("missing, stale and orphan rows are repaired and reported", () => {
    const chain = [row("p1"), row("p2", { executedPeriods: 2, lastPeriod: 1 })];
    const index = [
      row("p2", { nextDueAt: 99n }),
      row("p3"),
      row("p4", { owner: "owner-b" }),
      row("p5", { status: "closed" }),
    ];
    const all = diffPlanIndex(chain, index);
    expect(all.upserts.map((r) => r.pda)).toEqual(["p1", "p2"]);
    expect(all.closes).toEqual(["p3", "p4"]);
    expect(all.drift).toEqual([
      { pda: "p1", kind: "missing", fields: [] },
      { pda: "p2", kind: "stale", fields: ["lastPeriod", "executedPeriods"] },
      { pda: "p3", kind: "orphan", fields: ["status"] },
      { pda: "p4", kind: "orphan", fields: ["status"] },
    ]);
    // A per-owner read never closes another owner's plans.
    expect(diffPlanIndex(chain, index, { owners: ["owner-a"] }).closes).toEqual(
      ["p3"],
    );
  });

  test("a moving nextDueAt alone is not drift", () => {
    expect(
      diffPlanIndex([row("p1")], [row("p1", { nextDueAt: 5n })]).drift,
    ).toEqual([]);
  });
});
