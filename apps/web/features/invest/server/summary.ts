import "server-only";
import { delegationTerms } from "@aroma/guard";
import { CLUSTER_LABEL } from "@/features/wallet/cluster";
import type { InvestClusterName, PlanSummary } from "../schema";
import { formatChainTime, formatPeriod, formatRaw } from "./format";

/**
 * The review text shown before the wallet signs (B3). It must say in plain words that the
 * Subscriptions approval is `(1 + catch-up window) × installment` per period by design (M6
 * decision 4), and that the program still takes at most ONE installment per period.
 */

export const RISK_NOTE =
  "Devnet test: the tokens have no real value. An installment runs only when Aroma's keeper " +
  "runs and a fresh Pyth price is available, which for stocks means US market hours. A period " +
  "that cannot run within the catch-up window is skipped, and the plan shows it as skipped.";

export function createSummary(input: {
  cluster: InvestClusterName;
  fundingSymbol: string;
  fundingDecimals: number;
  fundingAmount: bigint;
  periodSeconds: bigint;
  periods: number;
  startsAt: bigint;
  catchUpWindowPeriods: number;
  allocations: { symbol: string; weightBps: number }[];
  balance: bigint;
}): PlanSummary {
  const amount = (raw: bigint) =>
    `${formatRaw(raw, input.fundingDecimals)} ${input.fundingSymbol}`;
  const expiresAt =
    input.startsAt + input.periodSeconds * BigInt(input.periods);
  const terms = delegationTerms(
    input.fundingAmount,
    input.catchUpWindowPeriods,
    input.periodSeconds,
    expiresAt,
  );
  const cadence = formatPeriod(input.periodSeconds);
  const mix = input.allocations
    .map((a) => `${a.symbol} ${formatRaw(BigInt(a.weightBps), 2)}%`)
    .join(" · ");
  const window = input.catchUpWindowPeriods;
  const approvalText =
    `Your wallet approves this plan to take up to ${amount(terms.amountPerPeriod)} per period ` +
    `from your ${input.fundingSymbol} account, until ${formatChainTime(terms.expiry)}. ` +
    (window > 0
      ? `That limit is ${1 + window} installments so that a missed installment can still run in the next ` +
        `${window === 1 ? "period" : `${window} periods`} (the catch-up window). `
      : "") +
    `The program itself takes at most one installment of ${amount(input.fundingAmount)} per period, ` +
    `and at most ${input.periods} in total (${amount(input.fundingAmount * BigInt(input.periods))}). ` +
    `Closing the plan revokes this approval in the same transaction.`;
  const lines = [
    `${amount(input.fundingAmount)} ${cadence}, ${input.periods} ${input.periods === 1 ? "installment" : "installments"}.`,
    `Split: ${mix}.`,
    `First period opens ${formatChainTime(input.startsAt)}; the schedule ends ${formatChainTime(expiresAt)}.`,
    `Each asset is bought at the Pyth oracle price at execution and delivered to your wallet.`,
    input.balance >= input.fundingAmount
      ? `Your ${input.fundingSymbol} balance now: ${amount(input.balance)}.`
      : `Your ${input.fundingSymbol} balance now is ${amount(input.balance)}, below one installment. Get test tokens from the faucet first, or installments will be skipped.`,
  ];
  return {
    cluster: input.cluster,
    label: CLUSTER_LABEL[input.cluster] ?? "",
    title: `Invest ${amount(input.fundingAmount)} ${cadence} into ${mix}`,
    lines,
    approval: {
      installmentRaw: input.fundingAmount.toString(),
      allowancePerPeriodRaw: terms.amountPerPeriod.toString(),
      catchUpWindowPeriods: window,
      delegationExpiresAt: terms.expiry.toString(),
      text: approvalText,
    },
    risk: RISK_NOTE,
  };
}

export function closeSummary(input: {
  cluster: InvestClusterName;
  fundingSymbol: string;
  executedPeriods: number;
  skippedPeriods: number;
  periods: number;
  revokeAuthority: boolean;
}): PlanSummary {
  const lines = [
    `Executed ${input.executedPeriods} of ${input.periods} installments; ${input.skippedPeriods} skipped.`,
    "Closing returns any funds held between legs and the plan's rent to your wallet.",
    "The recurring approval for this plan is revoked in the same transaction.",
    ...(input.revokeAuthority
      ? [
          `This is your last plan funded with ${input.fundingSymbol}, so the token-account approval is removed too.`,
        ]
      : []),
  ];
  return {
    cluster: input.cluster,
    label: CLUSTER_LABEL[input.cluster] ?? "",
    title: "Close this plan and revoke its approval",
    lines,
    approval: {
      installmentRaw: "0",
      allowancePerPeriodRaw: "0",
      catchUpWindowPeriods: 0,
      delegationExpiresAt: "0",
      text: "After this transaction nothing can be taken from your wallet for this plan.",
    },
    risk: RISK_NOTE,
  };
}
