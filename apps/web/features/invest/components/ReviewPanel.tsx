"use client";

import { Badge, Button } from "@ovelo/ui";
import { RiskDisclosure } from "../../compliance/components/RiskDisclosure";
import type { PlanSummary } from "../schema";
import type { FlowStep } from "../queries";

/**
 * The server's review text, shown verbatim before the wallet signs: title, lines, the plain-words
 * approval (it says the approval covers (1 + window) installments per period and that at most one
 * installment is taken per period), the cluster label and the risk note. The confirm control
 * lives INSIDE the devnet risk disclosure (M9 compliance gate, COMPLIANCE.md §5), the way the
 * trade review's does, so the plan cannot be signed without it rendered.
 */
export function ReviewPanel({
  summary,
  state,
  confirmLabel,
  onConfirm,
  onBack,
  testId,
}: {
  summary: PlanSummary;
  state: FlowStep;
  confirmLabel: string;
  onConfirm: () => void;
  onBack: () => void;
  testId: string;
}) {
  const busy = state.step === "signing" || state.step === "submitting";
  return (
    <section
      aria-labelledby="review-title"
      className="flex flex-col gap-4 rounded-tile border border-border-strong bg-raised-2 p-4 md:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="review-title" className="font-display text-title text-ink">
          {summary.title}
        </h4>
        <Badge tone="warning">{summary.label}</Badge>
      </div>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-small text-ink tabular-nums marker:text-muted">
        {summary.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div
        data-testid="review-approval"
        className="flex flex-col gap-1 rounded-tile border border-line bg-raised p-4 text-small"
      >
        <p className="text-caption text-muted">What your wallet approves</p>
        <p className="text-ink">{summary.approval.text}</p>
      </div>
      <p className="text-caption text-muted">{summary.risk}</p>
      <p
        role="status"
        aria-live="polite"
        className="text-small text-muted empty:hidden"
      >
        {state.step === "signing"
          ? "Confirm the transaction in your wallet."
          : state.step === "submitting"
            ? "Submitting to Solana and waiting for confirmation…"
            : ""}
      </p>
      <RiskDisclosure surface="recurring-devnet">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button
            variant="solid"
            data-testid={testId}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </RiskDisclosure>
    </section>
  );
}
