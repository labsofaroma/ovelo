/**
 * The per-period story of a plan, from the chain (plan account) and execution records (the
 * `InstallmentExecuted` events, as stored in receipts). Pure and bigint-only; the web app and
 * the keeper share it.
 *
 * The program executes periods oldest first and never goes back (math.rs), so every period up
 * to `last_executed_period` is either executed or skipped. Records say which; when they cannot
 * (a period settled on-chain whose execution is not indexed yet) the entry says so instead of
 * guessing, and `consistent` is false so callers reconcile from chain history.
 */
import type { LegExecuted, Plan } from "./generated";
import { NO_PERIOD } from "./constants";
import { runnablePeriod, scheduleIndex } from "./schedule";

export type PeriodStatus =
  "executed" | "skipped" | "pending" | "due" | "in_progress" | "unindexed";

export type TimelineExecution = {
  signature: string;
  /** Unix seconds from the chain, when known. */
  blockTime: bigint | null;
  legs: LegExecuted[];
  /** True on the transaction whose legs completed the period. */
  periodComplete: boolean;
};

export type TimelineEntry = {
  period: number;
  /** When the period opens (unix seconds). */
  scheduledAt: bigint;
  status: PeriodStatus;
  /**
   * For `skipped`: true when the program has already counted it in `skipped_periods`; false when
   * it is past the catch-up window and will be counted at the plan's next execution.
   */
  recordedOnChain: boolean;
  /** Transactions that executed legs of this period (empty unless executed or in progress). */
  executions: TimelineExecution[];
};

export type TimelinePlan = Pick<
  Plan,
  | "startsAt"
  | "periodSeconds"
  | "periods"
  | "lastExecutedPeriod"
  | "executedPeriods"
  | "skippedPeriods"
  | "legBitmap"
  | "inProgressPeriod"
  | "catchUpWindowPeriods"
>;

export type Timeline = {
  entries: TimelineEntry[];
  /** Records agree with the plan's on-chain counters. */
  consistent: boolean;
  /** Periods settled on-chain whose records are missing. */
  unindexed: number[];
};

function complete(executions: readonly TimelineExecution[] | undefined) {
  return Boolean(executions?.some((e) => e.periodComplete));
}

export function planTimeline(params: {
  plan: TimelinePlan;
  /** Unix seconds (chain time). */
  now: bigint;
  /** Execution records by period. */
  executions: ReadonlyMap<number, readonly TimelineExecution[]>;
}): Timeline {
  const { plan, now, executions } = params;
  const last =
    plan.lastExecutedPeriod === NO_PERIOD ? -1 : plan.lastExecutedPeriod;
  const inProgress = plan.legBitmap !== 0 ? plan.inProgressPeriod : null;
  const index = scheduleIndex(now, plan.startsAt, plan.periodSeconds);
  // The first in-window period that can still run (nothing when a period is in flight).
  const runnable =
    inProgress === null && index !== null
      ? runnablePeriod(
          plan.lastExecutedPeriod,
          plan.periods,
          plan.catchUpWindowPeriods,
          index,
        )
      : null;
  const recordedExecuted = new Set<number>();
  for (const [period, list] of executions)
    if (period <= last && complete(list)) recordedExecuted.add(period);
  // When records cover every executed period, the remaining settled periods are skipped.
  const allExecutedKnown = recordedExecuted.size === plan.executedPeriods;
  const entries: TimelineEntry[] = [];
  const unindexed: number[] = [];
  for (let period = 0; period < plan.periods; period += 1) {
    const scheduledAt = plan.startsAt + plan.periodSeconds * BigInt(period);
    const records = [...(executions.get(period) ?? [])];
    const entry = (
      status: PeriodStatus,
      recordedOnChain: boolean,
    ): TimelineEntry => ({
      period,
      scheduledAt,
      status,
      recordedOnChain,
      executions:
        status === "executed" || status === "in_progress" ? records : [],
    });
    if (period <= last || (inProgress !== null && period < inProgress)) {
      // Settled on-chain (executed, or counted as skipped when a later period started).
      if (recordedExecuted.has(period)) entries.push(entry("executed", true));
      else if (allExecutedKnown || period > last)
        entries.push(entry("skipped", true));
      else {
        unindexed.push(period);
        entries.push(entry("unindexed", true));
      }
      continue;
    }
    if (inProgress !== null && period === inProgress) {
      entries.push(entry("in_progress", true));
      continue;
    }
    if (index === null || BigInt(period) > index) {
      entries.push(entry("pending", false));
      continue;
    }
    // period <= index and not settled: due if still runnable, otherwise it missed the window.
    if (inProgress === null && runnable && period >= runnable.period)
      entries.push(entry("due", false));
    else if (inProgress !== null) entries.push(entry("pending", false));
    else entries.push(entry("skipped", false));
  }
  const skippedRecorded = entries.filter(
    (e) => e.status === "skipped" && e.recordedOnChain,
  ).length;
  const consistent =
    unindexed.length === 0 &&
    recordedExecuted.size === plan.executedPeriods &&
    skippedRecorded === plan.skippedPeriods;
  return { entries, consistent, unindexed };
}
