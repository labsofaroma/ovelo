import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ReactNode,
  type Ref,
  type SVGProps,
} from "react";
import { cn } from "../../lib/cn";

/** Aroma mark: a faceted gem. Uses currentColor; the facet lines punch through to the page. */
export function AromaGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      width="30"
      height="34"
      viewBox="0 0 30 34"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M15 1L29 13L15 28L1 13L15 1Z" fill="currentColor" />
      <path d="M15 1V28M1 13H29" stroke="var(--aroma-bg)" strokeWidth="1.5" />
      <path d="M15 28L20 33" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** What Brand hands to a router link. A call signature (not ComponentType) so next/link fits. */
export type BrandLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
};

export type BrandVariant = "horizontal" | "stacked" | "glyph" | "wordmark";

export interface BrandProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children"
> {
  /** `horizontal`: glyph beside wordmark. `stacked`: wordmark below. `glyph`/`wordmark`: one part. */
  variant?: BrandVariant;
  /** Link target. Default "/". */
  href?: string;
  /**
   * Router link component, e.g. next/link. Defaults to a plain <a>. Kept injectable so this
   * package never imports a framework router.
   */
  LinkComponent?: (props: BrandLinkProps) => ReactNode;
  /** Render without a link (header lockups on the home page, footers). */
  asStatic?: boolean;
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-ink text-[2.1875rem] leading-none font-semibold tracking-[-0.075em]",
        className,
      )}
    >
      aroma<span className="text-accent">.</span>
    </span>
  );
}

/**
 * Logo lockup. The accessible name is "Aroma home" when linked. `glyph` and `wordmark` are
 * for tight spaces; colors come from tokens so every lockup adapts to light and dark.
 */
export const Brand = forwardRef<HTMLAnchorElement, BrandProps>(function Brand(
  {
    variant = "horizontal",
    href = "/",
    LinkComponent,
    asStatic = false,
    className,
    ...props
  },
  ref,
) {
  const content = (
    <>
      {variant !== "wordmark" && <AromaGlyph />}
      {variant !== "glyph" && <Wordmark />}
    </>
  );
  const layout = cn(
    "inline-flex items-center gap-2.5 text-accent",
    variant === "stacked" && "flex-col gap-1.5",
    className,
  );
  if (asStatic) {
    return (
      <span className={layout} role="img" aria-label="Aroma">
        {content}
      </span>
    );
  }
  const Link = LinkComponent ?? "a";
  return (
    <Link
      ref={ref}
      href={href}
      aria-label="Aroma home"
      className={cn(layout, "rounded-control focus-ring")}
      {...props}
    >
      {content}
    </Link>
  );
});

/** Decorative orbit artwork for empty and error states. Purely ornamental (aria-hidden). */
export function OrbitArt({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-auto w-full max-w-90 text-muted", className)}
      viewBox="0 0 360 250"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <g transform="translate(180 125)">
        <ellipse rx="118" ry="47" transform="rotate(-32)" />
        <ellipse rx="118" ry="47" transform="rotate(32)" />
        <ellipse rx="118" ry="47" transform="rotate(90)" />
        <circle r="68" />
        <path
          d="M0 -58L51 -9L0 57L-51 -9Z"
          fill="var(--aroma-accent)"
          stroke="none"
        />
        <path d="M0 -58V57M-51 -9H51" stroke="var(--aroma-bg)" />
        <circle
          cx="100"
          cy="-61"
          r="7"
          fill="var(--aroma-accent)"
          stroke="none"
        />
        <circle
          cx="-73"
          cy="-87"
          r="4"
          fill="var(--aroma-accent)"
          stroke="none"
        />
        <circle
          cx="8"
          cy="116"
          r="5"
          fill="var(--aroma-accent)"
          stroke="none"
        />
      </g>
    </svg>
  );
}
