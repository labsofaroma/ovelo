import Link from "next/link";
import { routes } from "../routes";
import { pageContainer, textLink } from "../styles";

/** The page body for an unknown URL (app/global-not-found.tsx). Plain text, no invented data. */
export function NotFound() {
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-4 py-12`}
    >
      <p className="text-caption font-medium text-muted">404</p>
      <h1 className="text-page font-semibold max-md:text-page-mobile">
        Page not found
      </h1>
      <p className="max-w-2xl text-body text-muted">
        This address does not match any page. It may have moved, or the link may
        be mistyped.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link className={textLink} href={routes.markets}>
          Browse markets
        </Link>
        <Link className={textLink} href={routes.home}>
          Ovelo home
        </Link>
      </div>
    </main>
  );
}
