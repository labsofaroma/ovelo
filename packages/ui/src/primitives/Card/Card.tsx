import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * - `default`: compact surface.
 * - `wide`: the app's main building block, a full-width card in a vertical stack.
 * - `hero`: a page-opening card with the landing's glow and 44px corners.
 * - `inset`: a tile inside another card.
 */
export type CardVariant = "default" | "wide" | "hero" | "inset";

export const cardVariants: Record<CardVariant, string> = {
  default: "rounded-panel border border-line bg-surface",
  wide: "w-full rounded-panel border border-line bg-surface edge-highlight",
  hero: "relative isolate w-full overflow-hidden rounded-hero border border-line bg-panel-gradient edge-highlight",
  inset: "rounded-tile border border-line bg-raised",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card"
      data-variant={variant}
      className={cn("text-ink", cardVariants[variant], className)}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn("flex flex-col gap-2 px-6 pt-6", className)}
      {...props}
    />
  );
});

export const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      data-slot="card-title"
      className={cn(
        "font-display text-title font-normal tracking-[-0.03em]",
        className,
      )}
      {...props}
    />
  );
});

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      data-slot="card-description"
      className={cn("text-small text-muted", className)}
      {...props}
    />
  );
});

export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn("p-6", className)}
      {...props}
    />
  );
});

export const CardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn("flex items-center gap-3 px-6 pb-6", className)}
      {...props}
    />
  );
});
