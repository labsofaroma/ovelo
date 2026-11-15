import { Badge } from "@ovelo/ui";
import type { ReactNode } from "react";
import { formatPeriod, formatRaw } from "../server/format";
import type { PlanView } from "../schema";
import { PlanTimeline } from "./PlanTimeline";

const STATUS: Record<PlanView["status"], string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
};

/** One plan: terms, counts, allocation and its per-period timeline. */
export function PlanCard({
  plan,
  cluster,
  explorerRpcUrl,
  actions,
}: {
  plan: PlanView;
  cluster: "devnet" | "localnet";
  explorerRpcUrl: string;
  actions?: ReactNode;
}) {
  const installment = `${formatRaw(BigInt(plan.installmentRaw), plan.fundingDecimals)} ${plan.fundingSymbol}`;
  return (
    <article
      data-testid="plan-card"
      data-plan={plan.pda}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-body font-semibold">
            {installment} {formatPeriod(BigInt(plan.periodSeconds))}
          </h3>
          <p className="text-caption text-muted">
            Plan {plan.pda.slice(0, 4)}…{plan.pda.slice(-4)} · {plan.periods}{" "}
            installments · catch-up window {plan.catchUpWindowPeriods}{" "}
            {plan.catchUpWindowPeriods === 1 ? "period" : "periods"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={plan.status === "active" ? "up" : "neutral"}>
            {STATUS[plan.status]}
          </Badge>
          {actions}
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-2 text-small md:grid-cols-3">
        <div>
          <dt className="text-caption text-muted">Executed</dt>
          <dd
            data-testid="plan-executed"
            className="font-semibold tabular-nums"
          >
            {plan.executedPeriods} of {plan.periods}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted">
            Skipped (recorded on-chain)
          </dt>
          <dd data-testid="plan-skipped" className="font-semibold tabular-nums">
            {plan.skippedPeriods}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted">Split</dt>
          <dd>
            {plan.outputs
              .map(
                (o) =>
                  `${o.symbol ?? o.mint.slice(0, 6)} ${formatRaw(BigInt(o.weightBps), 2)}%`,
              )
              .join(" · ")}
          </dd>
        </div>
      </dl>
      {plan.timelineComplete ? null : (
        <p role="status" className="text-caption text-muted">
          Some settled periods are still being indexed from the chain.
        </p>
      )}
      <PlanTimeline
        entries={plan.timeline}
        fundingSymbol={plan.fundingSymbol}
        fundingDecimals={plan.fundingDecimals}
        cluster={cluster}
        explorerRpcUrl={explorerRpcUrl}
      />
    </article>
  );
}
