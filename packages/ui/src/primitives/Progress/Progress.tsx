"use client";

import { Progress as BaseProgress } from "@base-ui/react/progress";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";

export interface ProgressProps extends Omit<
  PartProps<typeof BaseProgress.Root>,
  "children"
> {
  /** Visible label. Without one, pass aria-label. */
  label?: string;
  /** Shows the numeric value next to the label. */
  showValue?: boolean;
}

/** Determinate progress when `value` is a number; indeterminate (animated bar) when `null`. */
export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  function Progress({ label, showValue, className, value, ...props }, ref) {
    return (
      <BaseProgress.Root
        ref={ref}
        value={value}
        className={cn("flex w-full flex-col gap-2", className)}
        {...props}
      >
        {(label || showValue) && (
          <div className="flex justify-between text-small">
            {label && (
              <BaseProgress.Label className="font-semibold text-ink">
                {label}
              </BaseProgress.Label>
            )}
            {showValue && (
              <BaseProgress.Value className="tabular-nums text-muted" />
            )}
          </div>
        )}
        <BaseProgress.Track className="relative h-2 w-full overflow-hidden rounded-full bg-line">
          <BaseProgress.Indicator
            className={cn(
              "h-full rounded-full bg-accent transition-[width] motion-slow",
              value === null && "w-2/5 animate-indeterminate",
            )}
          />
        </BaseProgress.Track>
      </BaseProgress.Root>
    );
  },
);
