"use client";

import { Input as BaseInput } from "@base-ui/react/input";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";
import { controlSurface, disabledStyles, focusRing } from "../../lib/styles";

export interface InputProps extends Omit<PartProps<typeof BaseInput>, "size"> {
  /** Marks the field invalid (sets aria-invalid and the error border). Inside <Field> this is automatic. */
  invalid?: boolean;
  size?: "sm" | "md";
}

/** Text input. Inside <Field> it is wired to the label, hint and error automatically. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = "md", className, ...props },
  ref,
) {
  return (
    <BaseInput
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlSurface,
        "w-full min-w-0 px-3 py-2.5 leading-snug caret-accent placeholder:text-muted",
        "aria-invalid:border-down data-[invalid]:border-down",
        size === "sm" && "min-h-(--ovelo-control-height-compact) py-2",
        "motion-base transition-colors hover:not-disabled:border-ink",
        focusRing,
        disabledStyles,
        className,
      )}
      {...props}
    />
  );
});
