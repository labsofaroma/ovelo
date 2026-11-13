"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { type PartProps } from "../../lib/types";

export interface FieldProps extends Omit<
  PartProps<typeof BaseField.Root>,
  "children"
> {
  label: ReactNode;
  /** Helper text, linked to the control with aria-describedby. */
  hint?: ReactNode;
  /** Error message. When set the field is invalid and the message is announced politely. */
  error?: ReactNode;
  /** Visible required marker. Also set `required` on the control. */
  required?: boolean;
  children: ReactNode;
}

/**
 * Label + control + hint + error with correct id wiring (Base UI Field). Put one form
 * control inside: <Input />, or a Select/Checkbox trigger that accepts the field context.
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, hint, error, required, invalid, className, children, ...props },
  ref,
) {
  const hasError = error != null && error !== false && error !== "";
  return (
    <BaseField.Root
      ref={ref}
      invalid={invalid ?? hasError}
      className={cn("flex flex-col gap-2", className)}
      {...props}
    >
      <BaseField.Label className="text-small font-semibold text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-down">
            *
          </span>
        )}
      </BaseField.Label>
      {children}
      {hint && (
        <BaseField.Description className="text-caption text-muted">
          {hint}
        </BaseField.Description>
      )}
      {hasError && (
        <BaseField.Error match className="text-caption font-medium text-down">
          {error}
        </BaseField.Error>
      )}
    </BaseField.Root>
  );
});
