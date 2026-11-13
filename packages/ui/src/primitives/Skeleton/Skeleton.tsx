import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * Placeholder block for content that is loading. Decorative: it is hidden from assistive
 * tech, so pair a group of skeletons with a labelled live region (e.g. aria-busy on the parent).
 */
export const Skeleton = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function Skeleton({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "h-4 animate-shimmer rounded-control bg-size-[200%_100%] bg-[linear-gradient(90deg,var(--aroma-surface),var(--aroma-raised),var(--aroma-surface))]",
        className,
      )}
      {...props}
    />
  );
});
