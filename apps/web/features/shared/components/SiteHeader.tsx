import Link from "next/link";
import { Brand } from "@aroma/ui";
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
          aria-label="Aroma home"
        />
        <nav aria-label="Primary" className="flex items-center gap-2">
          <NavLinks />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
