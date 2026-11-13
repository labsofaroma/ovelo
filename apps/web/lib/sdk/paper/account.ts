import type {
  PaperAccount,
  PaperOrder,
  PaperPlan,
  PaperPosition,
} from "./types";

/** Persisted paper state is untrusted. Reject corrupt state instead of silently minting virtual cash. */
export function parsePaperAccount(value: unknown): PaperAccount | null {
  if (!value || typeof value !== "object") return null;
  const account = value as Record<string, unknown>;
  const record = (item: unknown): Record<string, unknown> =>
    item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const positive = (item: unknown): item is number =>
    typeof item === "number" && Number.isFinite(item) && item > 0;
  const nonnegative = (item: unknown): item is number =>
    typeof item === "number" && Number.isFinite(item) && item >= 0;
  const text = (item: unknown): item is string =>
    typeof item === "string" && item.length > 0 && item.length <= 250;
  const date = (item: unknown): item is string =>
    text(item) && Number.isFinite(Date.parse(item));
  if (
    account.version !== 1 ||
    !nonnegative(account.cashUsd) ||
    !positive(account.startingCashUsd) ||
    !Array.isArray(account.positions) ||
    !Array.isArray(account.orders)
  )
    return null;
  const plans = account.plans ?? [];
  if (
    !Array.isArray(plans) ||
    account.positions.length > 10_000 ||
    account.orders.length > 100_000 ||
    plans.length > 1_000
  )
    return null;
  if (
    !account.positions.every((item) => {
      const p = record(item);
      return (
        text(p.mint) &&
        text(p.symbol) &&
        positive(p.quantity) &&
        nonnegative(p.costBasisUsd)
      );
    })
  )
    return null;
  if (
    new Set(account.positions.map((item) => record(item).mint)).size !==
    account.positions.length
  )
    return null;
  if (
    !account.orders.every((item) => {
      const o = record(item);
      return (
        text(o.id) &&
        text(o.mint) &&
        text(o.symbol) &&
        (o.side === "buy" || o.side === "sell") &&
        positive(o.quantity) &&
        positive(o.priceUsd) &&
        positive(o.totalUsd) &&
        date(o.createdAt) &&
        (o.swapId === undefined || text(o.swapId)) &&
        (o.realizedPnlUsd === undefined ||
          (typeof o.realizedPnlUsd === "number" &&
            Number.isFinite(o.realizedPnlUsd)))
      );
    })
  )
    return null;
  if (
    !plans.every((item) => {
      const p = record(item);
      return (
        text(p.id) &&
        text(p.targetId) &&
        (p.targetType === "asset" || p.targetType === "basket") &&
        text(p.name) &&
        positive(p.amountUsd) &&
        ["daily", "weekly", "biweekly", "monthly"].includes(
          String(p.frequency),
        ) &&
        typeof p.active === "boolean" &&
        date(p.nextExecutionAt) &&
        date(p.createdAt) &&
        (p.lastError === null || text(p.lastError))
      );
    })
  )
    return null;
  return {
    version: 1,
    cashUsd: account.cashUsd,
    startingCashUsd: account.startingCashUsd,
    positions: account.positions as PaperPosition[],
    orders: account.orders as PaperOrder[],
    plans: plans as PaperPlan[],
  };
}

export function createPaperAccount(startingCashUsd = 10_000): PaperAccount {
  if (
    !Number.isFinite(startingCashUsd) ||
    startingCashUsd <= 0 ||
    startingCashUsd > 1_000_000_000
  )
    throw new Error("Enter a valid virtual starting balance.");
  return {
    version: 1,
    cashUsd: startingCashUsd,
    startingCashUsd,
    positions: [],
    orders: [],
    plans: [],
  };
}
