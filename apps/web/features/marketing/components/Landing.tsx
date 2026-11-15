import { LandingHero } from "./LandingHero";
import { LandingSections } from "./LandingSections";
import "./landing-page.css";

/**
 * The landing page from the frontend redesign: hero with floating stock chips and illustrative
 * basket cards (each labelled as illustrative), "Built with", how it works and the tools. The page
 * draws its own header, so its route group has no SiteHeader.
 */
export function Landing() {
  return (
    <main id="main-content">
      <div className="lp lp-s1">
        <LandingHero />
        <LandingSections />
      </div>
    </main>
  );
}
