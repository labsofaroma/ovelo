"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import {
  MobileTabBar,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Sidebar,
  SidebarGroup,
  SidebarLink,
  cn,
} from "@ovelo/ui";
import { AccountMenu } from "./AccountMenu";
import { AppBrand } from "./AppBrand";
import { shell } from "./copy";
import { isActive, primaryNav, secondaryNav } from "./navigation";
import { SearchDialog } from "./SearchDialog";

function SearchButton({
  onOpen,
  compact = false,
}: {
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={shell.searchButton}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-full border border-line bg-raised text-small text-muted focus-ring hover:border-border-strong hover:text-ink",
        compact ? "size-11 justify-center" : "w-full px-4",
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      {!compact && (
        <>
          <span className="flex-1 text-left">{shell.searchButton}</span>
          <kbd className="rounded-badge border border-line px-1.5 text-micro">
            {shell.searchShortcut}
          </kbd>
        </>
      )}
    </button>
  );
}

/**
 * The app frame: a fixed left sidebar on wide screens; a top bar, bottom tab bar and "More" sheet
 * on phones. `banner` sits above the content and `footer` below it, both inside the content column.
 */
export function AppShell({
  children,
  banner,
  footer,
}: {
  children: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
}) {
  const path = usePathname() ?? "";
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => setMoreOpen(false), [path]);

  const openSearch = () => setSearchOpen(true);

  return (
    <div className="min-h-dvh bg-bg">
      <div data-ui="v2">
        <Sidebar
          label={shell.nav.label}
          brand={<AppBrand />}
          footer={
            <>
              <SearchButton onOpen={openSearch} />
              <AccountMenu />
            </>
          }
        >
          <SidebarGroup label={shell.nav.groups.invest}>
            {primaryNav.map(({ href, label, icon }) => (
              <SidebarLink
                key={href}
                href={href}
                icon={icon}
                active={isActive(path, href)}
                LinkComponent={Link}
              >
                {label}
              </SidebarLink>
            ))}
          </SidebarGroup>
          <SidebarGroup label={shell.nav.groups.you}>
            {secondaryNav.map(({ href, label, icon }) => (
              <SidebarLink
                key={href}
                href={href}
                icon={icon}
                active={isActive(path, href)}
                LinkComponent={Link}
              >
                {label}
              </SidebarLink>
            ))}
          </SidebarGroup>
        </Sidebar>

        <header className="sticky top-0 z-sticky flex h-16 items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur-md lg:hidden">
          <AppBrand />
          <div className="flex items-center gap-2">
            <SearchButton onOpen={openSearch} compact />
            <AccountMenu compact />
          </div>
        </header>
      </div>

      <div className="flex min-h-dvh flex-col lg:pl-(--ovelo-sidebar-width)">
        {banner}
        {/* Each page renders its own <main id="main-content"> (skip link target). */}
        <div data-ui="v2" className="w-full flex-1 pt-5 pb-8 md:pt-8">
          {children}
        </div>
        <div className="pb-24 lg:pb-0">{footer}</div>
      </div>

      <div data-ui="v2">
        <MobileTabBar
          label={shell.nav.mobileLabel}
          LinkComponent={Link}
          tabs={primaryNav.map(({ href, label, icon }) => ({
            href,
            label,
            icon,
            active: isActive(path, href),
          }))}
          extra={
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger
                aria-label={shell.more.open}
                className="flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-control text-micro font-medium text-muted focus-ring"
              >
                <MoreHorizontal className="size-5" aria-hidden />
                {shell.nav.more}
              </SheetTrigger>
              <SheetContent
                data-ui="v2"
                side="bottom"
                className="flex flex-col gap-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
              >
                <SheetTitle className="font-display text-title">
                  {shell.more.title}
                </SheetTitle>
                <ul className="flex flex-col gap-1">
                  {secondaryNav.map(({ href, label, icon: Icon }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={isActive(path, href) ? "page" : undefined}
                        className="flex min-h-12 items-center gap-3 rounded-full px-4 text-small text-ink hover:bg-raised focus-ring aria-[current=page]:bg-raised-2"
                      >
                        <Icon className="size-4.5 text-muted" aria-hidden />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </SheetContent>
            </Sheet>
          }
        />
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </div>
  );
}
