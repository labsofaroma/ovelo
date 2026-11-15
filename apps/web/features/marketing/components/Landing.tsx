import Link from "next/link";
import { Badge } from "@ovelo/ui";
import { routes } from "../../shared/routes";
import { linkButton, pageContainer, textLink } from "../../shared/styles";
import type { Loaded } from "../../shared/upstream";
import type { LandingSnapshot } from "../server";
import { LandingHero } from "./LandingHero";
import { LandingMotionLazy } from "./LandingMotionLazy";
import { LandingSections } from "./LandingSections";
import { MarketSnapshot } from "./MarketSnapshot";
import "./landing-page.css";

/** PRODUCT.md: always say which mode something is. Copy only, no figures. */
const MODES = [
  {
    badge: "Mainnet",
    title: "Spot purchases",
    body: "Buy tokenized stocks and baskets on Solana mainnet. Each purchase is a transaction you review and sign in your own wallet.",
    href: routes.markets,
    cta: "Buy on mainnet",
  },
  // Invest hidden: recurring is off the frontend until mainnet recurring ships (see _invest).
  // {
  //   badge: "Devnet test",
  //   title: "Recurring investing test",
  //   body: "A vaultless recurring plan that runs on Solana devnet with test tokens only. It is not available on mainnet.",
  //   href: routes.invest,
  //   cta: "Try the devnet test",
  // },
  {
    badge: "Paper",
    title: "Paper practice",
    body: "Practise with simulated funds stored on your device. Paper fills are not real trades and cannot be withdrawn. Choose Paper practice on any stock's buy ticket.",
    href: routes.markets,
    cta: "Pick a stock to practise",
  },
] as const;

const STEPS = [
  {
    title: "Research",
    body: "Compare issuer-listed tokenized stocks with observed prices, company profiles, financials and news, each with its source and time.",
  },
  {
    title: "Choose",
    body: "Pick a single stock or a themed basket. Basket allocations come from Ovelo’s published definitions, not hand-entered figures.",
  },
  {
    title: "Keep custody",
    body: "Funds stay in your wallet. Nothing moves without a transaction you sign.",
  },
] as const;

/**
 * The landing page from the frontend redesign: hero with floating stock chips and illustrative
 * basket cards (each labelled as illustrative), then the labelled modes and the sourced market
 * snapshot. The page draws its own header, so its route group has no SiteHeader.
 */
export function Landing({ snapshot }: { snapshot: Loaded<LandingSnapshot> }) {
  return (
    <main id="main-content">
      <div className="lp lp-s1">
        <LandingHero />
        <LandingSections />
        <div
          data-ui="v2"
          className={`${pageContainer} flex flex-col gap-16 pt-8 pb-24`}
        >
          <MarketSnapshot snapshot={snapshot} />

          <section
            aria-labelledby="modes-heading"
            data-reveal
            className="flex flex-col gap-4"
          >
            <h2 id="modes-heading" className="text-section font-semibold">
              Two ways to use Ovelo, always labelled
            </h2>
            <ul className="grid gap-4 md:grid-cols-2">
              {MODES.map((mode) => (
                <li
                  key={mode.title}
                  className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-5"
                >
                  <Badge tone="neutral" className="self-start">
                    {mode.badge}
                  </Badge>
                  <h3 className="text-title font-semibold">{mode.title}</h3>
                  <p className="text-small text-muted">{mode.body}</p>
                  <Link
                    className={`${textLink} mt-auto self-start text-small font-semibold`}
                    href={mode.href}
                  >
                    {mode.cta}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="how-heading"
            data-reveal
            className="flex flex-col gap-4"
          >
            <h2 id="how-heading" className="text-section font-semibold">
              How Ovelo works
            </h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex flex-col gap-2 border-t border-line pt-4"
                >
                  <span className="text-caption font-semibold text-muted">
                    Step {index + 1}
                  </span>
                  <h3 className="text-title font-semibold">{step.title}</h3>
                  <p className="text-small text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="cta-heading"
            data-reveal
            className="flex flex-col items-start gap-4 rounded-panel bg-raised p-8"
          >
            <h2 id="cta-heading" className="text-section font-semibold">
              Start with the data
            </h2>
            <p className="max-w-2xl text-body text-muted">
              Browse every issuer-listed token, see what is priced and what is
              not, and follow the ones you care about on this device.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link className={linkButton.primary} href={routes.markets}>
                Browse all listings
              </Link>
              <Link className={linkButton.secondary} href={routes.baskets}>
                See baskets
              </Link>
            </div>
          </section>
        </div>
        <LandingMotionLazy />
      </div>
    </main>
  );
}
