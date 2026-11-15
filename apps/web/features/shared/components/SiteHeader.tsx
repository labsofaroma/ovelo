import Link from "next/link";
import { Brand } from "@ovelo/ui";
import { routes } from "../routes";
import { pageContainer } from "../styles";
import { NavLinks } from "./NavLinks";

/**
 * Header for pages outside the app frame (privacy, terms, restricted, 404): the Ovelo lockup and
 * the primary nav as pills, over the page's own glow. The nav is the only client island.
 */
export function SiteHeader() {
  return (
    <header className="relative">
      <div
        className={`${pageContainer} flex min-h-16 flex-wrap items-center justify-between gap-3 py-4 md:py-5`}
      >
        <Brand
          href={routes.home}
          LinkComponent={Link}
          aria-label="Ovelo home"
        />
        {/* M9: on phones the nav takes its own row and wraps, so the page never scrolls sideways. */}
        <nav
          aria-label="Primary"
          className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end"
        >
          <NavLinks />
        </nav>
      </div>
    </header>
  );
}
