import Image from "next/image";
import Link from "next/link";
import { LandingHeader } from "./LandingHeader";

/** The hero: glow, stars, floating stock chips, headline and the illustrative basket cards. */
export function LandingHero() {
  return (
    <section className="lp-hero lp-s2">
      <div className="lp-s3" aria-hidden="true"></div>
      <svg className="lp-s4" aria-hidden="true" width="100%" height={900}>
        <filter id="heroGrain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          ></feTurbulence>
          <feColorMatrix type="saturate" values="0"></feColorMatrix>
        </filter>
        <rect width="100%" height="100%" filter="url(#heroGrain)"></rect>
      </svg>
      <div className="lp-s5" aria-hidden="true"></div>
      <div className="lp-s6" aria-hidden="true"></div>
      <div className="lp-s7" aria-hidden="true"></div>
      <div className="lp-s8" aria-hidden="true"></div>
      <div className="lp-hero-dot lp-s9" aria-hidden="true"></div>
      <div className="lp-main-horizon lp-s10" aria-hidden="true"></div>
      <LandingHeader />
      <div className="lp-ticker lp-float-a lp-s20" aria-hidden="true">
        <div className="lp-s21">
          <Image
            className="lp-s22"
            src="/company-logos/nvda.webp"
            alt=""
            width={32}
            height={32}
          />
          <span className="lp-s23">NVIDIA</span>
          <span className="lp-s24">NVDAx</span>
        </div>
      </div>
      <div className="lp-ticker lp-float-b lp-s25" aria-hidden="true">
        <div className="lp-s21">
          <Image
            className="lp-s22"
            src="/company-logos/aapl.webp"
            alt=""
            width={32}
            height={32}
          />
          <span className="lp-s26">Apple</span>
          <span className="lp-s27">AAPLx</span>
        </div>
      </div>
      <div className="lp-ticker lp-float-c lp-s28" aria-hidden="true">
        <div className="lp-s29">
          <Image
            className="lp-s30"
            src="/company-logos/msft.webp"
            alt=""
            width={36}
            height={36}
          />
          <span className="lp-s31">Microsoft</span>
          <span className="lp-s32">MSFTx</span>
        </div>
      </div>
      <div className="lp-ticker lp-float-d lp-s33" aria-hidden="true">
        <div className="lp-s34">
          <Image
            className="lp-s35"
            src="/company-logos/tsla.webp"
            alt=""
            width={40}
            height={40}
          />
          <span className="lp-s36">Tesla</span>
          <span className="lp-s37">TSLAx</span>
        </div>
      </div>
      <Link className="lp-hero-badge lp-s38" href="/markets">
        <span className="lp-s39">
          <span className="lp-s40"></span>
          Paper
        </span>
        <span className="lp-s41">Practise on any stock’s buy ticket →</span>
      </Link>
      <h1 className="lp-hero-title lp-s42">
        Invest in stock
        <br />
        baskets on Solana
      </h1>
      <p className="lp-hero-sub lp-s43">
        Research tokenized equities, build a basket and sign every purchase with
        your own wallet.
      </p>
      <div className="lp-hero-cta lp-s44">
        <Link className="lp-cta lp-s45" href="/markets">
          Start with paper practice
          <svg
            width={18}
            height={12}
            viewBox="0 0 18 12"
            fill="none"
            stroke="#f4f4f6"
            strokeWidth="1.3"
            aria-hidden="true"
          >
            <path d="M0 6h17M12 1l5 5-5 5"></path>
          </svg>
        </Link>
        <Link className="lp-cta lp-s46" href="/markets">
          Explore markets
        </Link>
      </div>
      <div
        className="lp-side-card lp-side-back lp-side-lb lp-from-left lp-s47"
        aria-hidden="true"
      ></div>
      <article
        className="lp-side-card lp-side-l lp-from-left lp-s48"
        aria-label="Illustrative basket example"
      >
        <span className="lp-s49">
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#eee"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="3" y="3" width={8} height={8} rx="2"></rect>
            <rect x="13" y="3" width={8} height={8} rx="2"></rect>
            <rect x="3" y="13" width={8} height={8} rx="2"></rect>
            <rect x="13" y="13" width={8} height={8} rx="2"></rect>
          </svg>
        </span>
        <span className="lp-s50">Sample basket</span>
        <span className="lp-s51">3 assets, weights total 100%</span>
        <span className="lp-s52">40 / 35 / 25</span>
        <span className="lp-s53">Illustrative allocation only</span>
      </article>
      <div
        className="lp-side-card lp-side-back lp-side-rb lp-from-right lp-s54"
        aria-hidden="true"
      ></div>
      <article
        className="lp-side-card lp-side-r lp-from-right lp-s55"
        aria-label="Recurring investing example"
      >
        <span className="lp-s49">
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f3f3f3"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M20 12a8 8 0 1 1-2.3-5.7"></path>
            <path d="M20 4v4.5h-4.5"></path>
            <path d="M12 8v4l3 2"></path>
          </svg>
        </span>
        <span className="lp-s50">Recurring plan</span>
        <span className="lp-s51">Devnet test-token demo</span>
        <span className="lp-s52">Weekly</span>
        <span className="lp-s53">Daily, weekly or every 30 days</span>
      </article>
      <article
        className="lp-main-card lp-rise lp-s56"
        aria-label="Illustrative basket review"
      >
        <div className="lp-s57" aria-hidden="true"></div>
        <div className="lp-s58" aria-hidden="true"></div>
        <div className="lp-s59" aria-hidden="true"></div>
        <div className="lp-s60" aria-hidden="true"></div>
        <span className="lp-s61">
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f0f0f0"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="3" y="3" width={8} height={8} rx="2"></rect>
            <rect x="13" y="3" width={8} height={8} rx="2"></rect>
            <rect x="3" y="13" width={8} height={8} rx="2"></rect>
            <rect x="13" y="13" width={8} height={8} rx="2"></rect>
          </svg>
        </span>
        <span className="lp-s62">Basket review</span>
        <span className="lp-s63">Illustrative, not live data</span>
        <span className="lp-main-status lp-s64">Minimum outputs shown</span>
        <span className="lp-s65">3 assets</span>
        <span className="lp-s66">one transaction first</span>
        <svg
          className="lp-main-chart lp-s67"
          role="img"
          aria-label="Sample allocation: 40, 35 and 25 percent"
          width={324}
          height={120}
          viewBox="0 0 324 120"
        >
          <g fontSize="9" fill="#a0a0a4">
            <text x="0" y="14">
              NVDAx
            </text>
            <text x="0" y="50">
              AAPLx
            </text>
            <text x="0" y="86">
              MSFTx
            </text>
          </g>
          <g fill="#2a2d33">
            <rect x="48" y="4" width={240} height={14} rx="7"></rect>
            <rect x="48" y="40" width={240} height={14} rx="7"></rect>
            <rect x="48" y="76" width={240} height={14} rx="7"></rect>
          </g>
          <g fill="#7d8088">
            <rect x="48" y="4" width={96} height={14} rx="7"></rect>
            <rect x="48" y="40" width={84} height={14} rx="7"></rect>
            <rect x="48" y="76" width={60} height={14} rx="7"></rect>
          </g>
          <g fontSize="9" fill="#d8d8d8">
            <text x="296" y="14">
              40%
            </text>
            <text x="296" y="50">
              35%
            </text>
            <text x="296" y="86">
              25%
            </text>
          </g>
        </svg>
        <div className="lp-main-low lp-s68">
          <div className="lp-s69">Custody</div>
          <div className="lp-s70">Your wallet</div>
        </div>
        <div className="lp-main-slider lp-s71" aria-hidden="true"></div>
        <div className="lp-main-slider lp-s72" aria-hidden="true"></div>
        <div className="lp-main-high lp-s73">
          <div className="lp-s69">Basket size</div>
          <div className="lp-s70">2 to 12</div>
        </div>
      </article>
    </section>
  );
}
