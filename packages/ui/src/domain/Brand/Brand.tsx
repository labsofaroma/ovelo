import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ReactNode,
  type Ref,
  type SVGProps,
  useId,
} from "react";
import { cn } from "../../lib/cn";
import { OVELO_MARK_PATH, OVELO_TILE_GRADIENT } from "./mark";

/**
 * Ovelo mark: the white mark on its peach-to-pink tile (mark.ts). Self-coloured, so it reads the
 * same on the light and dark page. The gradient id is per instance (several lockups per page).
 */
export function OveloGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  const gradient = `ovelo-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient
          id={gradient}
          x1="0"
          y1="32"
          x2="32"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={OVELO_TILE_GRADIENT.from} />
          <stop offset="1" stopColor={OVELO_TILE_GRADIENT.to} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradient})`} />
      <path
        transform="translate(6 6) scale(0.2)"
        fill="#fff"
        fillRule="evenodd"
        d={OVELO_MARK_PATH}
      />
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
  /** Replaces the Ovelo glyph (decorative, empty alt: the lockup carries the accessible name). */
  mark?: ReactNode;
  /**
   * Router link component, e.g. next/link. Defaults to a plain <a>. Kept injectable so this
   * package never imports a framework router.
   */
  LinkComponent?: (props: BrandLinkProps) => ReactNode;
  /** Render without a link (header lockups on the home page, footers). */
  asStatic?: boolean;
}

/** The redesign's wordmark: display face 26/400, tight tracking, no period. */
function Wordmark() {
  return (
    <span className="font-display text-[1.625rem] leading-none font-normal tracking-[-0.035em] text-ink">
      ovelo
    </span>
  );
}

/** Logo lockup. The accessible name is "Ovelo home" when linked, "Ovelo" when static. */
export const Brand = forwardRef<HTMLAnchorElement, BrandProps>(function Brand(
  {
    variant = "horizontal",
    href = "/",
    mark,
    LinkComponent,
    asStatic = false,
    className,
    ...props
  },
  ref,
) {
  const content = (
    <>
      {variant !== "wordmark" && (
        <span className="inline-flex shrink-0" data-slot="brand-mark">
          {mark ?? <OveloGlyph />}
        </span>
      )}
      {variant !== "glyph" && <Wordmark />}
    </>
  );
  const layout = cn(
    "inline-flex items-center gap-3",
    variant === "stacked" && "flex-col gap-2",
    className,
  );
  if (asStatic) {
    return (
      <span className={layout} role="img" aria-label="Ovelo">
        {content}
      </span>
    );
  }
  const Link = LinkComponent ?? "a";
  return (
    <Link
      ref={ref}
      href={href}
      aria-label="Ovelo home"
      className={cn(layout, "rounded-control focus-ring")}
      {...props}
    >
      {content}
    </Link>
  );
});
