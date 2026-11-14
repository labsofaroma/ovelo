import Link from "next/link";
import { Badge } from "@aroma/ui";
import { routes } from "../../shared/routes";
import { linkButton, pageContainer } from "../../shared/styles";
import type { Loaded } from "../../shared/upstream";
import type { LandingSnapshot } from "../server";
import { LandingMotionLazy } from "./LandingMotionLazy";
import { MarketSnapshot } from "./MarketSnapshot";

/** PRODUCT.md: always say which mode something is. Copy only, no figures. */
const MODES = [
  {
    badge: "Mainnet",
    title: "Spot purchases",
    body: "Buy tokenized stocks and baskets on Solana mainnet. Each purchase is a transaction you review and sign in your own wallet. Coming to this preview with wallet trading.",
  },
  {
    badge: "Devnet test",
    title: "Recurring investing test",
    body: "A vaultless recurring plan that runs on Solana devnet with test tokens only. It is not available on mainnet.",
  },
  {
    badge: "Paper",
    title: "Paper practice",
    body: "Practise with simulated funds stored on your device. Paper fills are not real trades and cannot be withdrawn.",
  },
] as const;

const STEPS = [
  {
    title: "Research",
    body: "Compare issuer-listed tokenized stocks with observed prices, company profiles, financials and news, each with its source and time.",
  },
  {
    title: "Choose",
    body: "Pick a single stock or a themed basket. Basket allocations come from Aroma’s published definitions, not hand-entered figures.",
  },
  {
    title: "Keep custody",
    body: "Funds stay in your wallet. Nothing moves without a transaction you sign.",
  },
] as const;

export function Landing({ snapshot }: { snapshot: Loaded<LandingSnapshot> }) {
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-16 py-12`}
    >
      <section
        aria-labelledby="hero-heading"
        className="flex max-w-3xl flex-col gap-6"
      >
        <p className="text-caption font-semibold uppercase tracking-wide text-muted">
          Tokenized stocks on Solana · mainnet spot, devnet test, paper practice
        </p>
        <h1
          id="hero-heading"
          className="text-[2.75rem] font-semibold leading-[1.05] tracking-tight max-md:text-page-mobile"
        >
          Own real stocks from your own wallet.{" "}
          <em className="font-serif font-normal italic">Research first.</em>
        </h1>
        <p className="text-title text-muted">
          Explore tokenized stocks and themed baskets with real, sourced market
          data. Every price says where it came from and when.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className={linkButton.primary} href={routes.markets}>
            Explore markets
          </Link>
          <Link className={linkButton.secondary} href={routes.baskets}>
            See baskets
          </Link>
        </div>
      </section>

      <MarketSnapshot snapshot={snapshot} />

      <section
        aria-labelledby="modes-heading"
        data-reveal
        className="flex flex-col gap-4"
      >
        <h2 id="modes-heading" className="text-section font-semibold">
          Three ways to use Aroma, always labelled
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
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
          How Aroma works
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
          Browse every issuer-listed token, see what is priced and what is not,
          and follow the ones you care about on this device.
        </p>
        <Link className={linkButton.primary} href={routes.markets}>
          Open markets
        </Link>
      </section>
      <LandingMotionLazy />
    </main>
  );
}
