import { forwardRef, useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type GradientTone = "silver" | "warm" | "plain";
export type GradientSize = "display" | "page" | "section";

const SIZES: Record<GradientSize, string> = {
  // All three stay at 24px or more, where the gradient's 3:1 large-text floor applies.
  display:
    "text-[2.25rem] leading-[1.05] md:text-display md:leading-[1] tracking-(--ovelo-tracking-display)",
  page: "text-page-mobile leading-tight md:text-page tracking-[-0.045em]",
  section: "text-[1.5rem] leading-tight md:text-[1.75rem] tracking-[-0.04em]",
};
const TONES: Record<GradientTone, string> = {
  silver: "text-silver",
  warm: "text-warm",
  plain: "text-ink",
};

export interface GradientHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: "h1" | "h2" | "h3";
  size?: GradientSize;
  tone?: GradientTone;
}

/** The landing page's headline: Manrope 400 with a horizontal silver sweep. */
export const GradientHeading = forwardRef<
  HTMLHeadingElement,
  GradientHeadingProps
>(function GradientHeading(
  { as: Tag = "h2", size = "section", tone = "silver", className, ...props },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cn(
        "font-display font-normal text-balance",
        SIZES[size],
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
});

/** Soft radial light behind a hero card. Decorative; place inside a `relative isolate` parent. */
export function Glow({
  tone = "blue",
  className,
}: {
  tone?: "blue" | "warm";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="glow"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        tone === "blue" ? "bg-glow-blue" : "bg-glow-warm",
        className,
      )}
    />
  );
}

/** Static film grain at low opacity. Decorative; never animated. */
export function Grain({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="grain"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 bg-grain opacity-[0.06] mix-blend-screen",
        className,
      )}
    />
  );
}

export interface SectionProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  /** Small label above the title, shown as a pill. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons or links aligned to the header's right edge (below it on phones). */
  actions?: ReactNode;
  /** `hero` adds the landing glow and grain and the 44px corners. */
  variant?: "wide" | "hero";
  /** Heading level for the title. Default h2. */
  headingLevel?: "h1" | "h2" | "h3";
  /** Title style. Hero titles default to the silver gradient. */
  titleTone?: GradientTone;
  /** Removes the body padding, e.g. for an edge-to-edge table. */
  flush?: boolean;
}

/**
 * The app's building block: a full-width card in a vertical stack, labelled by its title.
 * Pass `id` to make it an anchor target (e.g. `#trade`).
 */
export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  {
    eyebrow,
    title,
    description,
    actions,
    variant = "wide",
    headingLevel = "h2",
    titleTone,
    flush = false,
    className,
    children,
    ...props
  },
  ref,
) {
  const titleId = useId();
  const hero = variant === "hero";
  const hasHeader = Boolean(eyebrow || title || description || actions);
  return (
    <section
      ref={ref}
      data-slot="section"
      data-variant={variant}
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        "relative isolate w-full scroll-mt-24 border border-line text-ink edge-highlight",
        hero
          ? "overflow-hidden rounded-[1.75rem] bg-panel-gradient md:rounded-hero"
          : "rounded-panel bg-surface",
        className,
      )}
      {...props}
    >
      {hero && (
        <>
          <Glow />
          <Grain />
        </>
      )}
      {hasHeader && (
        <header
          className={cn(
            "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
            hero ? "px-6 pt-8 md:px-12 md:pt-12" : "px-5 pt-5 md:px-8 md:pt-7",
            !children && (hero ? "pb-8 md:pb-12" : "pb-5 md:pb-7"),
          )}
        >
          <div className="flex min-w-0 flex-col gap-3">
            {eyebrow && (
              <span className="inline-flex w-fit items-center rounded-full border border-line bg-raised-2 px-3 py-1 text-caption font-medium text-ink">
                {eyebrow}
              </span>
            )}
            {title && (
              <GradientHeading
                id={titleId}
                as={headingLevel}
                size={hero ? "page" : "section"}
                tone={titleTone ?? (hero ? "silver" : "plain")}
              >
                {title}
              </GradientHeading>
            )}
            {description && (
              <p className="max-w-[60ch] text-body leading-body text-muted">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              {actions}
            </div>
          )}
        </header>
      )}
      {children && (
        <div
          data-slot="section-body"
          className={cn(
            !flush &&
              (hero
                ? "px-6 pb-8 pt-6 md:px-12 md:pb-12"
                : "px-5 pb-5 pt-5 md:px-8 md:pb-7"),
            flush && hasHeader && "pt-5",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
});

/** Vertical stack of Sections with the app's standard rhythm. */
export function Stack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex w-full flex-col gap-4 md:gap-5", className)}
      {...props}
    />
  );
}
