import Link from "next/link";
import { routes } from "../routes";
import { pageContainer, textLink } from "../styles";
import { PrivacyChoicesButton } from "./PrivacyChoicesButton";

/** Shared v1 footer: legal links and the standing data and risk disclosure. */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-bg py-8 text-caption text-muted">
      <div className={`${pageContainer} flex flex-col gap-4`}>
        <p className="max-w-3xl">
          Market data is observed from the sources named next to each figure and
          may be delayed, stale or unavailable. Tokenized stocks carry market,
          liquidity, issuer and network risk. Nothing here is investment advice.
          Trading is not available in this preview.
        </p>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap gap-4">
            <li>
              <Link className={textLink} href={routes.privacy}>
                Privacy policy
              </Link>
            </li>
            <li>
              <Link className={textLink} href={routes.terms}>
                Terms &amp; conditions
              </Link>
            </li>
            <li>
              <PrivacyChoicesButton />
            </li>
            <li>
              <Link className={textLink} href={routes.home}>
                Aroma home
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
