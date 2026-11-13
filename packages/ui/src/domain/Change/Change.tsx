import { forwardRef, type HTMLAttributes } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatSignedUnits } from "../../format";

export type ChangeDirection = "up" | "down" | "flat" | "unavailable";

export interface ChangeValue {
  /** Raw integer. With `decimals` 2, 123n means 1.23. */
  value: bigint;
  decimals: number;
}

export interface ChangeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Percent change. `null`/`undefined` renders the honest "unavailable" state. */
  percent?: ChangeValue | null;
  /** Absolute change in the quote currency, shown next to the percent when given. */
  amount?: (ChangeValue & { symbol?: string }) | null;
  /** Fraction digits for the percent. Default 2. */
  percentDigits?: number;
  /** Fraction digits for the amount. Default 2. */
  amountDigits?: number;
}

const WORDS: Record<ChangeDirection, string> = {
  up: "Up",
  down: "Down",
  flat: "No change",
  unavailable: "Change unavailable",
};

const COLORS: Record<ChangeDirection, string> = {
  up: "text-up",
  down: "text-down",
  flat: "text-muted",
  unavailable: "text-muted",
};

const ICONS = { up: ArrowUp, down: ArrowDown, flat: Minus, unavailable: Minus };

/**
 * Signed change with three redundant cues so color is never the only signal: an arrow,
 * an explicit +/− sign, and screen-reader text ("Up", "Down", "No change"). Direction is
 * decided AFTER rounding, so "−0.00%" is shown as flat "0.00%".
 */
export const Change = forwardRef<HTMLSpanElement, ChangeProps>(function Change(
  { percent, amount, percentDigits = 2, amountDigits = 2, className, ...props },
  ref,
) {
  const pct = percent
    ? formatSignedUnits(percent.value, percent.decimals, {
        fractionDigits: percentDigits,
      })
    : null;
  const amt = amount
    ? formatSignedUnits(amount.value, amount.decimals, {
        fractionDigits: amountDigits,
      })
    : null;
  const lead = pct ?? amt;
  const direction: ChangeDirection = !lead
    ? "unavailable"
    : lead.sign > 0
      ? "up"
      : lead.sign < 0
        ? "down"
        : "flat";
  const Icon = ICONS[direction];

  return (
    <span
      ref={ref}
      data-direction={direction}
      className={cn(
        "inline-flex items-center gap-1 text-small font-semibold tabular-nums",
        COLORS[direction],
        className,
      )}
      {...props}
    >
      {direction !== "unavailable" && (
        <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
      )}
      <span className="sr-only">{WORDS[direction]} </span>
      {lead ? (
        <>
          {pct && <span>{pct.signed}%</span>}
          {pct && amt && " "}
          {amt && (
            <span className={pct ? "text-muted font-medium" : undefined}>
              {pct ? "(" : ""}
              {amt.sign < 0 ? "−" : amt.sign > 0 ? "+" : ""}
              {amount?.symbol ?? ""}
              {amt.text}
              {pct ? ")" : ""}
            </span>
          )}
        </>
      ) : (
        <span aria-hidden="true">—</span>
      )}
    </span>
  );
});
