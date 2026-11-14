import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { NO_PERIOD } from "./constants";
import { runnablePeriod, scheduleIndex } from "./schedule";
import {
  planTimeline,
  type TimelineExecution,
  type TimelinePlan,
} from "./timeline";

const START = 1_000_000n;
const P = 100n;

type Sim = { plan: TimelinePlan; executions: Map<number, TimelineExecution[]> };

/** The program's bookkeeping (math.rs): oldest runnable period first, skips counted at execution. */
function simulate(periods: number, window: number, runTimes: bigint[]): Sim {
  const plan: TimelinePlan = {
    startsAt: START,
    periodSeconds: P,
    periods,
    lastExecutedPeriod: NO_PERIOD,
    executedPeriods: 0,
    skippedPeriods: 0,
    legBitmap: 0,
    inProgressPeriod: NO_PERIOD,
    catchUpWindowPeriods: window,
  };
  const executions = new Map<number, TimelineExecution[]>();
  for (const t of [...runTimes].sort((a, b) => (a < b ? -1 : 1))) {
    const index = scheduleIndex(t, START, P);
    if (index === null) continue;
    const due = runnablePeriod(plan.lastExecutedPeriod, periods, window, index);
    if (!due) continue;
    plan.skippedPeriods += due.newlySkipped;
    plan.executedPeriods += 1;
    plan.lastExecutedPeriod = due.period;
    executions.set(due.period, [
      {
        signature: `sig-${due.period}`,
        blockTime: t,
        legs: [],
        periodComplete: true,
      },
    ]);
  }
  return { plan, executions };
}

describe("planTimeline", () => {
  test("property: every period is accounted for exactly once and matches the on-chain counters", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 0, max: 4 }),
        fc.array(fc.bigInt({ min: START - 200n, max: START + 30n * P }), {
          maxLength: 40,
        }),
        fc.bigInt({ min: START - 50n, max: START + 30n * P }),
        (periods, window, runs, nowOffset) => {
          const now = runs.reduce((a, b) => (b > a ? b : a), nowOffset);
          const { plan, executions } = simulate(periods, window, runs);
          const { entries, consistent, unindexed } = planTimeline({
            plan,
            now,
            executions,
          });
          expect(entries).toHaveLength(periods);
          expect(entries.map((e) => e.period)).toEqual([
            ...Array(periods).keys(),
          ]);
          expect(consistent).toBe(true);
          expect(unindexed).toEqual([]);
          const executed = entries.filter((e) => e.status === "executed");
          expect(executed).toHaveLength(plan.executedPeriods);
          expect(
            entries.filter((e) => e.status === "skipped" && e.recordedOnChain),
          ).toHaveLength(plan.skippedPeriods);
          // Never more than one installment per period, never above the schedule.
          expect(
            plan.executedPeriods + plan.skippedPeriods,
          ).toBeLessThanOrEqual(periods);
          // Statuses are ordered: settled, then (in-progress | due | missed), then pending.
          const index = scheduleIndex(now, START, P);
          for (const e of entries) {
            if (e.status === "pending")
              expect(index === null || BigInt(e.period) > index).toBe(true);
            if (e.status === "due") {
              expect(index).not.toBeNull();
              expect(BigInt(e.period) <= index!).toBe(true);
              expect(BigInt(e.period) >= index! - BigInt(window)).toBe(true);
            }
            if (e.status === "skipped" && !e.recordedOnChain)
              expect(BigInt(e.period) < index! - BigInt(window)).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  test("a keeper paused past the window: the missed period shows as skipped before and after it is recorded", () => {
    // Window 1. Period 0 runs on time, the keeper is down for periods 1-2, then runs in period 3.
    const runs = [START + 5n];
    const before = simulate(5, 1, runs);
    const now = START + 3n * P + 5n;
    const t1 = planTimeline({
      plan: before.plan,
      now,
      executions: before.executions,
    });
    expect(t1.entries.map((e) => [e.status, e.recordedOnChain])).toEqual([
      ["executed", true],
      ["skipped", false], // past the window, not yet counted
      ["due", false], // the oldest runnable (catch-up)
      ["due", false],
      ["pending", false],
    ]);
    const after = simulate(5, 1, [...runs, now]);
    const t2 = planTimeline({
      plan: after.plan,
      now,
      executions: after.executions,
    });
    expect(after.plan.skippedPeriods).toBe(1);
    expect(t2.entries.map((e) => [e.status, e.recordedOnChain])).toEqual([
      ["executed", true],
      ["skipped", true],
      ["executed", true],
      ["due", false],
      ["pending", false],
    ]);
    expect(t2.entries[2]!.executions[0]!.signature).toBe("sig-2");
  });

  test("missing records are reported as unindexed, never guessed", () => {
    const { plan, executions } = simulate(4, 0, [
      START + 1n,
      START + P + 1n,
      START + 3n * P + 1n,
    ]);
    executions.delete(1);
    const t = planTimeline({ plan, now: START + 3n * P + 2n, executions });
    expect(t.consistent).toBe(false);
    expect(t.unindexed).toEqual([1, 2]);
    expect(t.entries.map((e) => e.status)).toEqual([
      "executed",
      "unindexed",
      "unindexed",
      "executed",
    ]);
  });

  test("a period split across transactions is in progress; earlier gaps are already skipped", () => {
    const plan: TimelinePlan = {
      startsAt: START,
      periodSeconds: P,
      periods: 4,
      lastExecutedPeriod: 0,
      executedPeriods: 1,
      skippedPeriods: 1,
      legBitmap: 0b1,
      inProgressPeriod: 2,
      catchUpWindowPeriods: 1,
    };
    const partial: TimelineExecution = {
      signature: "leg-0",
      blockTime: START + 2n * P + 3n,
      legs: [],
      periodComplete: false,
    };
    const t = planTimeline({
      plan,
      now: START + 3n * P,
      executions: new Map([
        [
          0,
          [
            {
              signature: "p0",
              blockTime: START,
              legs: [],
              periodComplete: true,
            },
          ],
        ],
        [2, [partial]],
      ]),
    });
    expect(t.entries.map((e) => e.status)).toEqual([
      "executed",
      "skipped",
      "in_progress",
      "pending",
    ]);
    expect(t.entries[2]!.executions).toEqual([partial]);
    expect(t.consistent).toBe(true);
  });

  test("before the start everything is pending, with the scheduled time of each period", () => {
    const { plan, executions } = simulate(3, 1, []);
    const t = planTimeline({ plan, now: START - 1n, executions });
    expect(t.entries.map((e) => [e.status, e.scheduledAt])).toEqual([
      ["pending", START],
      ["pending", START + P],
      ["pending", START + 2n * P],
    ]);
  });
});
