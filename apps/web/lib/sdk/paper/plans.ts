import type { MarketSnapshot } from "../markets";
import { resolveMarketBaskets } from "../markets";
import { executePaperBasket } from "./basket";
import { executePaperOrder } from "./orders";
import type { PaperAccount, PaperFrequency, PaperPlan } from "./types";

export function nextPaperExecution(
  frequency: PaperFrequency,
  from: string,
): string {
  if (!["daily", "weekly", "biweekly", "monthly"].includes(frequency))
    throw new Error("Invalid plan frequency.");
  const date = new Date(from);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid plan date.");
  if (frequency === "monthly") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else
    date.setUTCDate(
      date.getUTCDate() + { daily: 1, weekly: 7, biweekly: 14 }[frequency],
    );
  return date.toISOString();
}

export function createPaperPlan(
  account: PaperAccount,
  input: Pick<
    PaperPlan,
    "targetId" | "targetType" | "name" | "amountUsd" | "frequency"
  >,
  now = new Date().toISOString(),
): PaperAccount {
  if (
    !input.targetId?.trim() ||
    !input.name?.trim() ||
    !["asset", "basket"].includes(input.targetType)
  )
    throw new Error("Choose a valid asset or basket for the plan.");
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0)
    throw new Error("Enter a valid recurring amount.");
  const plan: PaperPlan = {
    ...input,
    id: `plan-${now}-${account.plans.length + 1}`,
    active: true,
    createdAt: now,
    nextExecutionAt: nextPaperExecution(input.frequency, now),
    lastError: null,
  };
  return { ...account, plans: [...account.plans, plan] };
}

export function togglePaperPlan(
  account: PaperAccount,
  planId: string,
): PaperAccount {
  return {
    ...account,
    plans: account.plans.map((plan) =>
      plan.id === planId
        ? { ...plan, active: !plan.active, lastError: null }
        : plan,
    ),
  };
}

/** Runs at most one due installment per plan when the app is open. Never fabricates backdated fills. */
export function runDuePaperPlans(
  account: PaperAccount,
  snapshot: MarketSnapshot,
  now = new Date().toISOString(),
): PaperAccount {
  let next = account;
  for (const plan of account.plans) {
    if (
      !plan.active ||
      new Date(plan.nextExecutionAt).getTime() > new Date(now).getTime()
    )
      continue;
    try {
      if (plan.targetType === "basket") {
        // Existing paper plans keep their original full allocations even when a
        // mainnet basket is retired after a DEX liquidity review.
        const basket =
          snapshot.baskets.find((item) => item.id === plan.targetId) ??
          resolveMarketBaskets(snapshot.assets).find(
            (item) => item.id === plan.targetId,
          );
        if (!basket) throw new Error("Basket is unavailable.");
        next = executePaperBasket(next, basket, plan.amountUsd, now);
      } else {
        const asset = snapshot.assets.find(
          (item) => item.mint === plan.targetId,
        );
        if (!asset) throw new Error("Asset is unavailable.");
        next = executePaperOrder(next, asset, "buy", plan.amountUsd, now);
      }
      next = {
        ...next,
        plans: next.plans.map((item) =>
          item.id === plan.id
            ? {
                ...item,
                nextExecutionAt: nextPaperExecution(item.frequency, now),
                lastError: null,
              }
            : item,
        ),
      };
    } catch (error) {
      next = {
        ...next,
        plans: next.plans.map((item) =>
          item.id === plan.id
            ? {
                ...item,
                lastError:
                  error instanceof Error
                    ? error.message
                    : "Plan could not execute.",
              }
            : item,
        ),
      };
    }
  }
  return next;
}
