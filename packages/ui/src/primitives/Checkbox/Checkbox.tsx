"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { disabledStyles, focusRing } from "../../lib/styles";

export interface CheckboxProps extends PartProps<typeof BaseCheckbox.Root> {
  /** Visible label. Omit only if you provide aria-label or an external <label>. */
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLElement, CheckboxProps>(
  function Checkbox({ label, className, ...props }, ref) {
    const box = (
      <BaseCheckbox.Root
        ref={ref}
        className={cn(
          "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-badge border border-border-strong bg-surface text-accent-ink transition-colors motion-fast",
          "data-[checked]:border-transparent data-[checked]:bg-accent data-[indeterminate]:border-transparent data-[indeterminate]:bg-accent",
          "data-[invalid]:border-down",
          focusRing,
          disabledStyles,
          !label && className,
        )}
        {...props}
      >
        <BaseCheckbox.Indicator className="flex data-[unchecked]:hidden">
          {props.indeterminate ? (
            <Minus size={14} strokeWidth={3} aria-hidden="true" />
          ) : (
            <Check size={14} strokeWidth={3} aria-hidden="true" />
          )}
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
    );
    if (!label) return box;
    return (
      <label
        className={cn(
          "inline-flex cursor-pointer items-center gap-3 text-small text-ink",
          className,
        )}
      >
        {box}
        <span>{label}</span>
      </label>
    );
  },
);
