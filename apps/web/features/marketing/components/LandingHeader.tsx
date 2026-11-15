import Link from "next/link";
import { Brand } from "@ovelo/ui";
import { routes } from "../../shared/routes";

/** The landing header: Ovelo lockup, centred nav pill, "Launch app" and the phone menu. */
export function LandingHeader() {
  return (
    <header className="lp-s11">
      <Brand className="lp-s12" href={routes.home} LinkComponent={Link} />
      <nav className="lp-nav-pill lp-s13" aria-label="Primary">
        <Link className="lp-nav-link lp-s14" href="/markets">
          Markets
        </Link>
        <Link className="lp-nav-link lp-s14" href="/baskets">
          Baskets
        </Link>
        {/* Invest hidden: recurring is off the frontend until mainnet recurring ships (see _invest).
        <Link className="lp-nav-link lp-s14" href="/invest">
          Recurring
        </Link> */}
        <Link className="lp-nav-link lp-s14" href="/portfolio">
          Portfolio
        </Link>
        <a className="lp-nav-link lp-s14" href="#how-it-works">
          How it works
        </a>
      </nav>
      <Link className="lp-cta lp-s15" href="/markets">
        Launch app
      </Link>
      <details className="lp-nav-menu lp-s16">
        <summary className="lp-s17" aria-label="Open menu">
          <svg
            width={18}
            height={12}
            viewBox="0 0 18 12"
            fill="none"
            stroke="#f4f4f6"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M0 1h18M0 6h18M0 11h18"></path>
          </svg>
        </summary>
        <div className="lp-s18">
          <Link className="lp-s19" href="/markets">
            Markets
          </Link>
          <Link className="lp-s19" href="/baskets">
            Baskets
          </Link>
          {/* Invest hidden: recurring is off the frontend until mainnet recurring ships (see _invest).
          <Link className="lp-s19" href="/invest">
            Recurring
          </Link> */}
          <Link className="lp-s19" href="/portfolio">
            Portfolio
          </Link>
          <a className="lp-s19" href="#how-it-works">
            How it works
          </a>
        </div>
      </details>
    </header>
  );
}
