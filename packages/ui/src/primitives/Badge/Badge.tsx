import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "accent" | "up" | "down" | "warning";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line bg-raised text-ink",
  accent: "border-transparent bg-accent-soft text-accent",
  up: "border-transparent bg-up-soft text-up",
  down: "border-transparent bg-down-soft text-down",
  warning: "border-transparent bg-warning-soft text-warning",
};

/** Short status label. Always carries text; never rely on `tone` alone to convey meaning. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-badge border px-2 py-1 text-micro font-semibold",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
});
