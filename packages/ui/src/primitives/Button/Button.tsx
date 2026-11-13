"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/styles";
import { Spinner } from "../Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks activation. Focus is kept (aria-disabled, not disabled). */
  loading?: boolean;
  fullWidth?: boolean;
}

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink border-transparent hover:bg-accent-hover",
  secondary: "bg-transparent text-ink border-border-strong hover:bg-raised",
  ghost:
    "bg-transparent text-muted border-transparent hover:bg-raised hover:text-ink",
  danger: "bg-down text-bg border-transparent hover:brightness-95",
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-(--aroma-control-height-compact) px-3 text-caption max-md:min-h-(--aroma-control-height)",
  md: "min-h-(--aroma-control-height) px-4 text-small",
  lg: "min-h-12 px-6 text-body",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      disabled,
      type = "button",
      className,
      children,
      onClick,
      ...props
    },
    ref,
  ) {
    const blocked = loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        aria-disabled={blocked || undefined}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (blocked) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center gap-2 rounded-control border font-semibold leading-snug transition-colors motion-base",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-progress",
          focusRing,
          buttonVariants[variant],
          buttonSizes[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading && <Spinner size="sm" label={null} />}
        {children}
      </button>
    );
  },
);
