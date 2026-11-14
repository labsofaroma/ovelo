/** Typed, checked decoders for v1 accounts, and the plan view the keeper and UI share. */
import type { Address, ReadonlyUint8Array } from "@solana/kit";
import {
  ASSET_DISCRIMINATOR,
  CONFIG_DISCRIMINATOR,
  PLAN_DISCRIMINATOR,
  getAssetDecoder,
  getConfigDecoder,
  getPlanDecoder,
  type Asset,
  type Config,
  type Plan,
} from "./generated";
import { NO_PERIOD } from "./constants";
import { runnablePeriod, scheduleIndex, type Due } from "./schedule";

export const ACCOUNT_VERSION = 1;

function startsWith(
  data: ReadonlyUint8Array,
  prefix: ReadonlyUint8Array,
): boolean {
  return (
    prefix.length <= data.length && prefix.every((byte, i) => data[i] === byte)
  );
}

function decodeChecked<T extends { version: number }>(
  name: string,
  data: ReadonlyUint8Array,
  discriminator: ReadonlyUint8Array,
  decode: (bytes: ReadonlyUint8Array) => T,
): T {
  if (!startsWith(data, discriminator))
    throw new Error(`Not an Aroma Guard v1 ${name} account.`);
  const value = decode(data);
  if (value.version !== ACCOUNT_VERSION)
    throw new Error(`Unsupported ${name} version ${value.version}.`);
  return value;
}

export const decodeConfigAccount = (data: ReadonlyUint8Array): Config =>
  decodeChecked("config", data, CONFIG_DISCRIMINATOR, (b) =>
    getConfigDecoder().decode(b),
  );

export const decodeAssetAccount = (data: ReadonlyUint8Array): Asset =>
  decodeChecked("asset", data, ASSET_DISCRIMINATOR, (b) =>
    getAssetDecoder().decode(b),
  );

export const decodePlanAccount = (data: ReadonlyUint8Array): Plan =>
  decodeChecked("plan", data, PLAN_DISCRIMINATOR, (b) =>
    getPlanDecoder().decode(b),
  );

export type PlanStatus =
  "paused" | "in_progress" | "due" | "waiting" | "finished";

export type PlanView = {
  address: Address;
  plan: Plan;
  status: PlanStatus;
  /** Index of the current schedule slot, or null before the start. */
  index: bigint | null;
  /** The period that can run now (oldest first), or null. */
  due: Due | null;
  /** Periods skipped on-chain plus periods that can no longer run (would be skipped). */
  skippedIncludingPending: number;
  /** Executed + skipped, in periods. */
  settledPeriods: number;
};

/** Plan state at `now` (seconds). Mirrors the program's schedule rules (`math.rs`). */
export function viewPlan(address: Address, plan: Plan, now: bigint): PlanView {
  const index = scheduleIndex(now, plan.startsAt, plan.periodSeconds);
  const due =
    plan.legBitmap !== 0
      ? { period: plan.inProgressPeriod, newlySkipped: 0 }
      : index === null
        ? null
        : runnablePeriod(
            plan.lastExecutedPeriod,
            plan.periods,
            plan.catchUpWindowPeriods,
            index,
          );
  const next =
    plan.lastExecutedPeriod === NO_PERIOD ? 0 : plan.lastExecutedPeriod + 1;
  let pending = due?.newlySkipped ?? 0;
  if (!due && index !== null && next < plan.periods) {
    // Nothing can run: every remaining period older than the window is lost.
    const oldestInWindow = Number(index) - plan.catchUpWindowPeriods;
    pending = Math.max(0, Math.min(plan.periods, oldestInWindow) - next);
  }
  const finished =
    plan.executedPeriods + plan.skippedPeriods + pending >= plan.periods &&
    plan.legBitmap === 0;
  const status: PlanStatus = plan.pausedByOwner
    ? "paused"
    : plan.legBitmap !== 0
      ? "in_progress"
      : finished
        ? "finished"
        : due
          ? "due"
          : "waiting";
  return {
    address,
    plan,
    status,
    index,
    due,
    skippedIncludingPending: plan.skippedPeriods + pending,
    settledPeriods: plan.executedPeriods + plan.skippedPeriods,
  };
}
