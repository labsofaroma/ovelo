import {
  Bookmark,
  Compass,
  Layers3,
  ListOrdered,
  Repeat2,
  Settings2,
  Sparkles,
  Wallet2,
} from "lucide-react";
import { routes } from "../shared/routes";
import { shell } from "./copy";

export const primaryNav = [
  { href: routes.markets, label: shell.nav.markets, icon: Compass },
  { href: routes.baskets, label: shell.nav.baskets, icon: Layers3 },
  { href: routes.invest, label: shell.nav.invest, icon: Repeat2 },
  { href: routes.portfolio, label: shell.nav.portfolio, icon: Wallet2 },
] as const;

export const secondaryNav = [
  { href: routes.watchlist, label: shell.nav.watchlist, icon: Bookmark },
  {
    href: `${routes.portfolio}#activity`,
    label: shell.nav.activity,
    icon: ListOrdered,
  },
  { href: routes.creators, label: shell.nav.creators, icon: Sparkles },
  { href: routes.settings, label: shell.nav.settings, icon: Settings2 },
] as const;

/** Which nav entry owns a path (detail pages belong to their list; anchors never own one). */
export function isActive(path: string, href: string): boolean {
  if (href.includes("#")) return false;
  if (path === href) return true;
  if (href === routes.markets) return path.startsWith("/stock/");
  if (href === routes.baskets) return path.startsWith("/basket/");
  return path.startsWith(`${href}/`);
}
