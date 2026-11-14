"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@aroma/ui";
import { routes } from "../routes";

const ITEMS = [
  {
    href: routes.markets,
    label: "Markets",
    match: ["/markets", "/stock"],
  },
  {
    href: routes.baskets,
    label: "Baskets",
    match: ["/baskets", "/basket/"],
  },
  { href: routes.watchlist, label: "Watchlist", match: ["/watchlist"] },
  { href: routes.portfolio, label: "Portfolio", match: ["/portfolio"] },
  { href: routes.creators, label: "Creators", match: ["/creators"] },
  // M7: devnet test only; the label says so. The v1 nav itself exists only while v1 is on.
  { href: routes.invest, label: "Invest (devnet)", match: ["/invest"] },
] as const;

/** Primary nav. Client only for `aria-current`; links work without JavaScript. */
export function NavLinks() {
  const pathname = usePathname() ?? "";
  return (
    <ul className="flex items-center gap-1">
      {ITEMS.map((item) => {
        const active = item.match.some((prefix) => pathname.startsWith(prefix));
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-(--aroma-control-height) items-center rounded-control px-3 text-small font-semibold transition-colors motion-base focus-ring",
                active ? "bg-raised text-ink" : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
