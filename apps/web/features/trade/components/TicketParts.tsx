import { cn } from "@ovelo/ui";
import type { ReactNode } from "react";

/**
 * Presentational pieces shared by the trade ticket and its review (redesign TicketParts).
 * Markup only: no amounts are computed here.
 */

/**
 * Pill segmented control built from real radio inputs, so the group keeps its radio semantics
 * (role, name, keyboard arrows). The input covers its pill invisibly, so a click lands on it.
 */
export function PillRadioGroup<Value extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: Value;
  options: readonly (readonly [Value, string])[];
  onChange: (value: Value) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-full max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-raised p-1 sm:w-auto"
    >
      {options.map(([option, text]) => (
        <label
          key={option}
          className={cn(
            "relative flex min-h-(--ovelo-control-height) flex-1 cursor-pointer items-center justify-center rounded-full px-5 text-small font-medium whitespace-nowrap transition-colors motion-fast sm:min-h-9 sm:flex-none",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
            "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
            value === option
              ? "bg-raised-2 text-ink edge-highlight"
              : "text-muted hover:text-ink",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
          />
          {text}
        </label>
      ))}
    </div>
  );
}

/** One side of a ticket: a raised panel holding a field and its footer line. */
export function TicketSide({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-tile border border-line bg-raised p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Big amount field. `data-ticket-amount` lets the sticky Buy bar focus it. */
export const amountInputClass =
  "focus-ring w-full min-w-0 rounded-control border border-border-strong bg-surface px-4 py-3 font-display text-[1.5rem] leading-tight tabular-nums text-ink caret-accent placeholder:text-muted hover:not-disabled:border-ink disabled:cursor-not-allowed disabled:opacity-50";

/** Funding-token select, styled to sit next to the amount field. */
export const selectClass =
  "focus-ring min-h-(--ovelo-control-height) w-full cursor-pointer rounded-full border border-line bg-raised-2 px-4 text-small font-medium text-ink hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50";

export function FinePrint({ children }: { children: ReactNode }) {
  return <p className="text-caption leading-body text-muted">{children}</p>;
}
