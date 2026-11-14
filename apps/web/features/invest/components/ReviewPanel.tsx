"use client";

import { Badge, Button } from "@aroma/ui";
import type { PlanSummary } from "../schema";
import type { FlowStep } from "../queries";

/**
 * The server's review text, shown verbatim before the wallet signs: title, lines, the plain-words
 * approval (it says the approval covers (1 + window) installments per period and that at most one
 * installment is taken per period), the cluster label and the risk note.
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
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="review-title" className="text-body font-semibold">
          {summary.title}
        </h3>
        <Badge tone="warning">{summary.label}</Badge>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-small">
        {summary.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div
        data-testid="review-approval"
        className="rounded-control border border-line bg-raised p-3 text-small"
      >
        <p className="font-semibold">What your wallet approves</p>
        <p>{summary.approval.text}</p>
      </div>
      <p className="text-caption text-muted">{summary.risk}</p>
      <p role="status" aria-live="polite" className="text-small text-muted">
        {state.step === "signing"
          ? "Confirm the transaction in your wallet."
          : state.step === "submitting"
            ? "Submitting to Solana and waiting for confirmation…"
            : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button data-testid={testId} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </section>
  );
}
