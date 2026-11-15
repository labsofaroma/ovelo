"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { cn } from "../../lib/cn";
import { focusRing } from "../../lib/styles";
import { Spinner } from "../Spinner";

export type ButtonVariant =
  "primary" | "solid" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks activation. Focus is kept (aria-disabled, not disabled). */
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * `primary` is the landing page's pill CTA (near-black, light hairline). `solid` is the single
 * silver action on a surface, e.g. "Review purchase". Use at most one `solid` per card.
 */
export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-pill text-ink border-(--ovelo-pill-border) hover:brightness-125 hover:border-border-strong",
  solid: "bg-accent text-accent-ink border-transparent hover:bg-accent-hover",
  secondary:
    "bg-raised-2 text-ink border-line hover:bg-raised hover:border-border-strong",
  ghost:
    "bg-transparent text-muted border-transparent hover:bg-raised-2 hover:text-ink",
  danger: "bg-down text-bg border-transparent hover:brightness-95",
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-(--ovelo-control-height-compact) px-4 text-caption max-md:min-h-(--ovelo-control-height)",
  md: "min-h-(--ovelo-control-height) px-5 text-small",
  lg: "min-h-14 px-7 text-body font-display",
};

/** Base classes every button shares. */
export const buttonBase =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border font-medium leading-snug tracking-[-0.01em] whitespace-nowrap transition-[color,background-color,border-color,filter] motion-base";

/**
 * Button styling for things that are not <button>, e.g. a router link:
 *   <Link className={buttonClassName({ variant: "primary" })} href="/baskets">…</Link>
 */
export function buttonClassName({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    buttonBase,
    focusRing,
    buttonVariants[variant],
    buttonSizes[size],
    fullWidth && "w-full",
    className,
  );
}

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
          buttonBase,
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
