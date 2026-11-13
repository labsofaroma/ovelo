import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Accessible name. Pass `null` when a parent already announces the busy state. */
  label?: string | null;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "size-3.5", md: "size-5", lg: "size-8" } as const;

/**
 * Indeterminate progress ring. Under reduced motion the rotation duration collapses, leaving
 * a static partial ring, which still reads as "busy" together with the accessible label.
 */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  function Spinner(
    { label = "Loading", size = "md", className, ...props },
    ref,
  ) {
    return (
      <span
        ref={ref}
        role={label ? "status" : undefined}
        aria-label={label ?? undefined}
        aria-hidden={label ? undefined : true}
        className={cn(
          "inline-block shrink-0 animate-spin-token rounded-full border-2 border-current border-t-transparent",
          SIZES[size],
          className,
        )}
        {...props}
      />
    );
  },
);
