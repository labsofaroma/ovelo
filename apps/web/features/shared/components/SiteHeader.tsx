import Link from "next/link";
import { Brand } from "@ovelo/ui";
import { routes } from "../routes";
import { pageContainer } from "../styles";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";

/** v1 header: brand, primary nav and theme. The nav and toggle are the only client islands. */
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div
        className={`${pageContainer} flex min-h-16 flex-wrap items-center justify-between gap-3 py-2`}
      >
        <Brand
          href={routes.home}
          LinkComponent={Link}
          aria-label="Ovelo home"
        />
        {/* M9: on phones the nav takes its own row and wraps, so the page never scrolls sideways. */}
        <nav
          aria-label="Primary"
          className="flex w-full flex-wrap items-center justify-between gap-2 md:w-auto md:justify-end"
        >
          <NavLinks />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
