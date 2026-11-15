import type { ReactNode } from "react";

export const WIZARD_STEPS = 4;

/**
 * One numbered step of the devnet plan builder (the redesign's stacked wizard). Renders an <li>;
 * the caller owns the <ol>. `last` hides the connector line under the number.
 */
export function WizardStep({
  n,
  title,
  last = false,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 md:gap-6">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-(--ovelo-pill-border) bg-pill font-display text-small text-ink tabular-nums"
        >
          {n}
        </span>
        {last ? null : (
          <span aria-hidden="true" className="mt-2 w-px flex-1 bg-line" />
        )}
      </div>
      <div
        className={`flex min-w-0 flex-1 flex-col gap-4 ${last ? "" : "pb-8"}`}
      >
        <div className="flex flex-col gap-1 pt-1.5">
          <span className="text-micro font-medium uppercase tracking-(--ovelo-tracking-eyebrow) text-muted">
            Step {n} of {WIZARD_STEPS}
          </span>
          <h3 className="font-display text-title text-ink">{title}</h3>
        </div>
        {children}
      </div>
    </li>
  );
}
