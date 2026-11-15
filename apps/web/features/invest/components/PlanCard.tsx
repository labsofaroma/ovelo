import { Badge, Progress } from "@ovelo/ui";
import { Repeat2 } from "lucide-react";
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
  const progress = plan.periods
    ? Math.round((plan.executedPeriods / plan.periods) * 100)
    : 0;
  return (
    <article
      data-testid="plan-card"
      data-plan={plan.pda}
      className="flex flex-col gap-4 rounded-tile border border-line bg-raised p-4 md:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised-2 text-muted">
            <Repeat2 className="size-4.5" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-display text-title text-ink tabular-nums">
              {installment} {formatPeriod(BigInt(plan.periodSeconds))}
            </h3>
            <p className="text-caption text-muted">
              Plan {plan.pda.slice(0, 4)}…{plan.pda.slice(-4)} · {plan.periods}{" "}
              installments · catch-up window {plan.catchUpWindowPeriods}{" "}
              {plan.catchUpWindowPeriods === 1 ? "period" : "periods"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={plan.status === "active" ? "up" : "neutral"}>
            {STATUS[plan.status]}
          </Badge>
          {actions}
        </div>
      </header>
      <Progress value={progress} aria-label="Installments executed" />
      <dl className="grid grid-cols-1 gap-3 text-small sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-tile border border-line bg-raised-2 p-3">
          <dt className="text-caption text-muted">Executed</dt>
          <dd
            data-testid="plan-executed"
            className="font-display text-title text-ink tabular-nums"
          >
            {plan.executedPeriods} of {plan.periods}
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-tile border border-line bg-raised-2 p-3">
          <dt className="text-caption text-muted">
            Skipped (recorded on-chain)
          </dt>
          <dd
            data-testid="plan-skipped"
            className="font-display text-title text-ink tabular-nums"
          >
            {plan.skippedPeriods}
          </dd>
        </div>
        <div className="flex flex-col gap-1 rounded-tile border border-line bg-raised-2 p-3">
          <dt className="text-caption text-muted">Split</dt>
          <dd className="text-ink tabular-nums">
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
