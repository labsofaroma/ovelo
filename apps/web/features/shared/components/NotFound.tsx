import Link from "next/link";
import { GradientHeading } from "@ovelo/ui";
import { routes } from "../routes";
import { eyebrowPill, linkButton } from "../styles";

/**
 * The page body for an unknown URL (app/global-not-found.tsx, which draws the glow behind it).
 * Plain text, no invented data.
 */
export function NotFound() {
  return (
    <main
      id="main-content"
      className="flex min-h-[60dvh] flex-col items-center justify-center px-(--ovelo-gutter-mobile) py-16 text-center md:px-(--ovelo-gutter)"
    >
      <div className="flex max-w-2xl flex-col items-center gap-5">
        <p className={eyebrowPill}>404</p>
        <GradientHeading as="h1" size="display">
          Page not found
        </GradientHeading>
        <p className="max-w-[48ch] text-body leading-body text-muted">
          This address does not match any page. It may have moved, or the link
          may be mistyped.
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-3">
          <Link className={linkButton.primary} href={routes.markets}>
            Browse markets
          </Link>
          <Link className={linkButton.secondary} href={routes.home}>
            Ovelo home
          </Link>
        </div>
      </div>
    </main>
  );
}
