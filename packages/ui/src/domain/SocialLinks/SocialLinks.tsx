import { cn } from "../../lib/cn";

export interface SocialLink {
  href: string;
  /** Visible text. */
  label: string;
  /** 24x24 viewBox path data for the icon. */
  iconPath: string;
}

export const AROMA_SOCIAL_LINKS: readonly SocialLink[] = [
  {
    href: "https://x.com/InvestonAroma",
    label: "Follow us on X",
    iconPath:
      "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.49h2.039L6.487 3.24H4.3l13.31 17.403Z",
  },
  {
    href: "https://t.me/+VI2AImUiyJIwNDI1",
    label: "Join Aroma Community",
    iconPath:
      "M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19l-9.48 5.99-4.1-1.28c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.06-1.99 1.94c-.23.23-.42.39-.83.39Z",
  },
];

export interface SocialLinksProps {
  links?: readonly SocialLink[];
  /** Accessible name of the nav landmark. Make it unique if the page has several. */
  label?: string;
  className?: string;
}

/** Community links. External links open in a new tab with `noopener noreferrer`. */
export function SocialLinks({
  links = AROMA_SOCIAL_LINKS,
  label = "Aroma community",
  className,
}: SocialLinksProps) {
  return (
    <nav
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}
    >
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-flex min-h-(--aroma-control-height) items-center gap-2 rounded-badge text-micro text-muted transition-colors motion-base hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={link.iconPath} />
          </svg>
          <span>
            {link.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </span>
        </a>
      ))}
    </nav>
  );
}
