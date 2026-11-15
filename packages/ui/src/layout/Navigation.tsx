import {
  type AnchorHTMLAttributes,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "../lib/cn";

/** What navigation hands to a router link (e.g. next/link). */
export type NavLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
};
export type NavLinkComponent = (props: NavLinkProps) => ReactNode;
/** Any icon component that takes a class and aria-hidden, e.g. a lucide-react icon. */
export type NavIcon = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  /** The logo lockup, usually <Brand />. */
  brand: ReactNode;
  /** Pinned to the bottom: mode switch, account, settings. */
  footer?: ReactNode;
  /** Accessible name of the navigation landmark. */
  label?: string;
}

/**
 * Fixed left sidebar for wide screens (hidden below `lg`; use MobileTabBar there).
 * Children are SidebarGroups.
 */
export function Sidebar({
  brand,
  footer,
  label = "Main",
  className,
  children,
  ...props
}: SidebarProps) {
  return (
    <aside
      data-slot="sidebar"
      className={cn(
        "fixed inset-y-0 left-0 z-sticky hidden w-(--ovelo-sidebar-width) flex-col border-r border-line bg-bg lg:flex",
        className,
      )}
      {...props}
    >
      <div className="flex h-20 shrink-0 items-center px-6">{brand}</div>
      <nav
        aria-label={label}
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-2"
      >
        {children}
      </nav>
      {footer && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-line p-3">
          {footer}
        </div>
      )}
    </aside>
  );
}

/** A labelled group of sidebar links. */
export function SidebarGroup({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <p className="px-3 pb-1 text-micro font-medium uppercase tracking-(--ovelo-tracking-eyebrow) text-muted">
          {label}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

export interface SidebarLinkProps {
  href: string;
  icon?: NavIcon;
  active?: boolean;
  LinkComponent?: NavLinkComponent;
  children: ReactNode;
}

/** One sidebar entry. The active page gets aria-current and a raised pill. */
export function SidebarLink({
  href,
  icon: Icon,
  active = false,
  LinkComponent,
  children,
}: SidebarLinkProps) {
  const Link = LinkComponent ?? "a";
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-full border px-3 text-small font-medium transition-colors motion-base focus-ring",
          active
            ? "border-line bg-raised-2 text-ink edge-highlight"
            : "border-transparent text-muted hover:bg-raised hover:text-ink",
        )}
      >
        {Icon && <Icon className="size-4.5 shrink-0" aria-hidden />}
        <span className="truncate">{children}</span>
      </Link>
    </li>
  );
}

export interface MobileTab {
  href: string;
  label: string;
  icon: NavIcon;
  active?: boolean;
}

/** Bottom tab bar for phones and tablets (hidden from `lg`). Up to five tabs. */
export function MobileTabBar({
  tabs,
  LinkComponent,
  extra,
  label = "Main",
  className,
}: {
  tabs: readonly MobileTab[];
  LinkComponent?: NavLinkComponent;
  /** A trailing control, e.g. a "More" button that opens a Sheet. */
  extra?: ReactNode;
  label?: string;
  className?: string;
}) {
  const Link = LinkComponent ?? "a";
  return (
    <nav
      aria-label={label}
      data-slot="mobile-tab-bar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-sticky border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden",
        className,
      )}
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around px-2">
        {tabs.map(({ href, label: text, icon: Icon, active }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-control text-micro font-medium focus-ring",
                active ? "text-ink" : "text-muted",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {text}
            </Link>
          </li>
        ))}
        {extra && <li className="flex flex-1">{extra}</li>}
      </ul>
    </nav>
  );
}

/**
 * A bar pinned to the bottom of the viewport, e.g. "Buy NVDAx" when the trade card is out of
 * view. Sits above the mobile tab bar. Render it only while it is needed.
 */
export function StickyActionBar({
  label,
  children,
  className,
}: {
  /** Accessible name of the region. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      data-slot="sticky-action-bar"
      className={cn(
        "fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-sticky mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-full border border-line bg-raised/95 py-2 pr-2 pl-5 shadow-float backdrop-blur-md lg:bottom-6 lg:left-[calc(var(--ovelo-sidebar-width)+1.5rem)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
