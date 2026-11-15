import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { routes } from "../routes";
import { pageContainer } from "../styles";
import { PrivacyChoicesButton } from "./PrivacyChoicesButton";

const link =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-small text-muted transition-colors motion-base focus-ring hover:bg-raised-2 hover:text-ink";

/** Shared v1 footer: the standing data and risk disclosure and the legal links, in one card. */
export function SiteFooter() {
  return (
    <footer className="mt-12 pb-10">
      <div className={pageContainer}>
        <div className="flex flex-col gap-5 rounded-panel border border-line bg-surface px-5 py-6 edge-highlight md:px-8">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full border-pill bg-pill">
              <ShieldCheck
                className="size-5 text-muted"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </span>
            <p className="max-w-4xl self-center text-caption leading-body text-muted">
              Market data is observed from the sources named next to each figure
              and may be delayed, stale or unavailable. Tokenized stocks carry
              market, liquidity, issuer and network risk. Nothing here is
              investment advice. Purchases are mainnet spot purchases signed in
              your own wallet; paper practice moves no funds.
            </p>
          </div>
          <nav aria-label="Legal" className="border-t border-line pt-3">
            <ul className="-mx-3 flex flex-wrap items-center">
              <li>
                <Link className={link} href={routes.privacy}>
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link className={link} href={routes.terms}>
                  Terms &amp; conditions
                </Link>
              </li>
              <li>
                <PrivacyChoicesButton className={link} />
              </li>
              <li>
                <Link className={link} href={routes.settings}>
                  Settings
                </Link>
              </li>
              <li>
                <Link className={link} href={routes.home}>
                  Ovelo home
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
