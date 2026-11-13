import Image from "next/image";
import Link from "next/link";
import "./landing-page.css";

// Landing page ported from the supplied design mockup. All figures on it are
// illustrative allocations or product facts; no market data is shown.
export function Landing() {
  return (
    <main id="main-content">
      <div className="lp" style={{ background: "#030303", color: "#f4f4f6", fontFamily: "var(--lp-font-body), Helvetica, Arial, sans-serif", overflow: "clip", WebkitFontSmoothing: "antialiased" }}>
        <section className="lp-hero" style={{ position: "relative", height: "1200px", overflow: "clip", background: "#040405" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "130px", width: "2100px", marginLeft: "-1050px", height: "760px", background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(61,106,144,.72) 0%, rgba(30,66,110,.55) 42%, rgba(10,34,72,.2) 72%, rgba(0,0,0,0) 100%)" }}>
          </div>
          <svg aria-hidden="true" width="100%" height={900} style={{ position: "absolute", left: "0", top: "0", opacity: ".055", mixBlendMode: "screen" }}>
            <filter id="heroGrain">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch">
              </feTurbulence>
              <feColorMatrix type="saturate" values="0">
              </feColorMatrix>
            </filter>
            <rect width="100%" height="100%" filter="url(#heroGrain)">
            </rect>
          </svg>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "0", width: "1440px", marginLeft: "-720px", height: "800px", backgroundRepeat: "no-repeat", backgroundImage: "radial-gradient(1.2px 1.2px at 170px 230px,#fff,transparent),radial-gradient(1px 1px at 388px 210px,#ddd,transparent),radial-gradient(1px 1px at 414px 212px,#ccc,transparent),radial-gradient(1px 1px at 520px 118px,#aaa,transparent),radial-gradient(1px 1px at 898px 134px,#bbb,transparent),radial-gradient(1px 1px at 930px 148px,#ccc,transparent),radial-gradient(1px 1px at 1048px 318px,#ddd,transparent),radial-gradient(1px 1px at 1150px 270px,#aaa,transparent),radial-gradient(1.2px 1.2px at 1212px 240px,#ddd,transparent),radial-gradient(1px 1px at 124px 292px,#999,transparent),radial-gradient(1px 1px at 640px 470px,#999,transparent),radial-gradient(1.2px 1.2px at 498px 660px,#fff,transparent),radial-gradient(1px 1px at 528px 700px,#ddd,transparent),radial-gradient(1.2px 1.2px at 890px 590px,#eee,transparent),radial-gradient(1px 1px at 985px 650px,#ccc,transparent),radial-gradient(1px 1px at 1012px 610px,#aaa,transparent),radial-gradient(1px 1px at 300px 720px,#999,transparent),radial-gradient(1px 1px at 760px 640px,#ddd,transparent),radial-gradient(1px 1px at 684px 680px,#ccc,transparent),radial-gradient(1px 1px at 1150px 730px,#999,transparent),radial-gradient(1px 1px at 1100px 690px,#bbb,transparent),radial-gradient(1px 1px at 860px 700px,#bbb,transparent)" }}>
          </div>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "421px", width: "2000px", height: "2000px", marginLeft: "-1000px", borderRadius: "50%", background: "#050506", boxShadow: "0 -1px 2px rgba(190,160,140,.16), 0 -3px 24px rgba(150,112,90,.12)" }}>
          </div>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "414px", width: "700px", marginLeft: "-350px", height: "14px", filter: "blur(3px)", background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(238,205,178,.22), rgba(0,0,0,0))" }}>
          </div>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "0", width: "1440px", marginLeft: "-720px", height: "800px", backgroundRepeat: "no-repeat", backgroundImage: "radial-gradient(1.4px 1.4px at 498px 660px,#fff,transparent),radial-gradient(1.2px 1.2px at 528px 700px,#eee,transparent),radial-gradient(1.4px 1.4px at 890px 590px,#fff,transparent),radial-gradient(1.2px 1.2px at 985px 650px,#ddd,transparent),radial-gradient(1px 1px at 1012px 610px,#ccc,transparent),radial-gradient(1px 1px at 300px 720px,#aaa,transparent),radial-gradient(1.2px 1.2px at 760px 640px,#eee,transparent),radial-gradient(1px 1px at 684px 680px,#ddd,transparent),radial-gradient(1px 1px at 1150px 730px,#aaa,transparent),radial-gradient(1px 1px at 1100px 690px,#ccc,transparent),radial-gradient(1px 1px at 860px 700px,#ccc,transparent),radial-gradient(1px 1px at 420px 610px,#bbb,transparent),radial-gradient(1px 1px at 600px 640px,#ccc,transparent),radial-gradient(1px 1px at 960px 720px,#ccc,transparent)" }}>
          </div>
          <div className="lp-hero-dot" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "177px", marginLeft: "-5px", width: "10px", height: "10px", borderRadius: "50%", background: "#5d5d62" }}>
          </div>
          <div className="lp-main-horizon" aria-hidden="true" style={{ position: "absolute", left: "50%", top: "968px", width: "660px", marginLeft: "-330px", height: "16px", background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(146,164,196,.5), rgba(0,0,0,0))" }}>
          </div>
          <header style={{ position: "absolute", left: "0", right: "0", top: "17px", height: "48px", zIndex: "5" }}>
            <Link href="/" aria-label="Aroma home" style={{ position: "absolute", left: "29px", top: "4px", display: "flex", alignItems: "center", gap: "13px", height: "38px" }}>
              <Image src="/images/brand/aroma-logo.png" alt="" width={36} height={38} style={{ width: "36px", height: "38px", objectFit: "contain" }} />
              <span style={{ fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "26px", fontWeight: "400", letterSpacing: "-.035em", color: "#f5f5f5" }}>
                aroma
              </span>
            </Link>
            <nav className="lp-nav-pill" aria-label="Primary" style={{ position: "absolute", left: "50%", marginLeft: "-252px", top: "0", width: "505px", height: "48px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: "23px", borderRadius: "20px", border: "1px solid rgba(190,205,230,.34)", background: "linear-gradient(180deg, rgba(50,60,80,.28), rgba(22,26,36,.5))" }}>
              <Link className="lp-nav-link" href="/markets" style={{ fontSize: "12.5px", fontWeight: "500", letterSpacing: "-0.01em" }}>
                Markets
              </Link>
              <Link className="lp-nav-link" href="/baskets" style={{ fontSize: "12.5px", fontWeight: "500", letterSpacing: "-0.01em" }}>
                Baskets
              </Link>
              <Link className="lp-nav-link" href="/sip" style={{ fontSize: "12.5px", fontWeight: "500", letterSpacing: "-0.01em" }}>
                Recurring
              </Link>
              <Link className="lp-nav-link" href="/portfolio" style={{ fontSize: "12.5px", fontWeight: "500", letterSpacing: "-0.01em" }}>
                Portfolio
              </Link>
              <a className="lp-nav-link" href="#how-it-works" style={{ fontSize: "12.5px", fontWeight: "500", letterSpacing: "-0.01em" }}>
                How it works
              </a>
            </nav>
            <Link className="lp-cta" href="/app" style={{ position: "absolute", right: "31px", top: "0", width: "117px", height: "48px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "15px", fontSize: "12.5px", fontWeight: "500", letterSpacing: "-.01em", background: "#1b1b1d", border: "1px solid #2c2c2f", borderTopColor: "#77777b", borderRightColor: "#55555a" }}>
              Launch app
            </Link>
            <details className="lp-nav-menu" style={{ position: "absolute", right: "158px", top: "0" }}>
              <summary aria-label="Open menu" style={{ width: "48px", height: "48px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "15px", border: "1px solid #2c2c2f", background: "#1b1b1d", cursor: "pointer" }}>
                <svg width={18} height={12} viewBox="0 0 18 12" fill="none" stroke="#f4f4f6" strokeWidth="1.5" aria-hidden="true">
                  <path d="M0 1h18M0 6h18M0 11h18">
                  </path>
                </svg>
              </summary>
              <div style={{ position: "absolute", right: "0", top: "56px", width: "190px", boxSizing: "border-box", padding: "8px", display: "flex", flexDirection: "column", borderRadius: "15px", border: "1px solid #2c2c2f", background: "#141416" }}>
                <Link href="/markets" style={{ padding: "12px", fontSize: "14px" }}>
                  Markets
                </Link>
                <Link href="/baskets" style={{ padding: "12px", fontSize: "14px" }}>
                  Baskets
                </Link>
                <Link href="/sip" style={{ padding: "12px", fontSize: "14px" }}>
                  Recurring
                </Link>
                <Link href="/portfolio" style={{ padding: "12px", fontSize: "14px" }}>
                  Portfolio
                </Link>
                <a href="#how-it-works" style={{ padding: "12px", fontSize: "14px" }}>
                  How it works
                </a>
              </div>
            </details>
          </header>
          <div className="lp-ticker lp-float-a" aria-hidden="true" style={{ position: "absolute", left: "calc(50% - 460px)", top: "176px", width: "112px", height: "46px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "23px", height: "23px", borderRadius: "50%", background: "#76b900", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700", color: "#fff" }}>
                N
              </span>
              <span style={{ fontSize: "10px", letterSpacing: "-.01em", color: "#a9a9ad" }}>
                NVIDIA
              </span>
              <span style={{ width: "30px", height: "12px", borderRadius: "3px", background: "#26262a", fontSize: "6px", lineHeight: "12px", textAlign: "center", color: "#8a8a8e" }}>
                xNVDA
              </span>
            </div>
            <div style={{ marginTop: "7px", fontSize: "7.5px", color: "#8a8a8e" }}>
              Tokenized equity
            </div>
          </div>
          <div className="lp-ticker lp-float-b" aria-hidden="true" style={{ position: "absolute", left: "calc(50% + 346px)", top: "176px", width: "112px", height: "46px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "23px", height: "23px", borderRadius: "50%", background: "#3a3a3e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700", color: "#fff" }}>
                A
              </span>
              <span style={{ fontSize: "10px", letterSpacing: "-.01em", color: "#b4b4b8" }}>
                Apple
              </span>
              <span style={{ width: "30px", height: "13px", borderRadius: "3px", background: "#2a2a2d", fontSize: "6px", lineHeight: "13px", textAlign: "center", color: "#8a8a8e" }}>
                xAAPL
              </span>
            </div>
            <div style={{ marginTop: "7px", fontSize: "7.5px", color: "#8a8a8e" }}>
              Tokenized equity
            </div>
          </div>
          <div className="lp-ticker lp-float-c" aria-hidden="true" style={{ position: "absolute", left: "calc(50% - 645px)", top: "338px", width: "140px", height: "54px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
              <span style={{ width: "27px", height: "27px", borderRadius: "50%", background: "#0078d4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: "700", color: "#fff" }}>
                M
              </span>
              <span style={{ fontSize: "12px", letterSpacing: "-.01em", color: "#c4c4c6" }}>
                Microsoft
              </span>
              <span style={{ width: "34px", height: "14px", borderRadius: "3px", background: "#2d2d2f", fontSize: "7px", lineHeight: "14px", textAlign: "center", color: "#8a8a8e" }}>
                xMSFT
              </span>
            </div>
            <div style={{ marginTop: "8px", fontSize: "8.5px", color: "#8a8a8e" }}>
              Tokenized equity
            </div>
          </div>
          <div className="lp-ticker lp-float-d" aria-hidden="true" style={{ position: "absolute", left: "calc(50% + 506px)", top: "332px", width: "150px", height: "60px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ width: "30px", height: "30px", borderRadius: "50%", background: "#c8382f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: "700", color: "#fff" }}>
                T
              </span>
              <span style={{ fontSize: "14px", letterSpacing: "-.015em", color: "#d0d0d2" }}>
                Tesla
              </span>
              <span style={{ width: "38px", height: "17px", borderRadius: "4px", background: "#302c2b", fontSize: "8px", lineHeight: "17px", textAlign: "center", color: "#8a8a8e" }}>
                xTSLA
              </span>
            </div>
            <div style={{ marginTop: "10px", fontSize: "10px", color: "#8a8a8e" }}>
              Tokenized equity
            </div>
          </div>
          <Link className="lp-hero-badge" href="/app" style={{ position: "absolute", left: "50%", marginLeft: "-165px", top: "224px", width: "328px", height: "39px", boxSizing: "border-box", display: "flex", alignItems: "center", gap: "12px", paddingLeft: "6px", borderRadius: "999px", border: "1px solid rgba(255,255,255,.3)", background: "rgba(10,9,9,.55)", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "14.5px", letterSpacing: "-.02em" }}>
            <span style={{ width: "73px", height: "29px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", borderRadius: "999px", border: "1px solid rgba(255,255,255,.34)", color: "#e6e6e6" }}>
              <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#fff" }}>
              </span>
              Paper
            </span>
            <span style={{ color: "#d2d0ce", whiteSpace: "nowrap" }}>
              Start with $10,000 virtual cash →
            </span>
          </Link>
          <h1 className="lp-hero-title" style={{ position: "absolute", left: "0", right: "0", top: "298px", margin: "0", textAlign: "center", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "100px", lineHeight: "93px", fontWeight: "400", letterSpacing: "-.03em", color: "transparent", background: "linear-gradient(90deg, #5c5956 15%, #8a8784 28%, #f4f2f0 50%, #8a8784 72%, #5c5956 85%)", WebkitBackgroundClip: "text", backgroundClip: "text" }}>
            Invest in stock
            <br />
            baskets on Solana
          </h1>
          <p className="lp-hero-sub" style={{ position: "absolute", left: "0", right: "0", top: "511px", margin: "0", textAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "20.5px", lineHeight: "28px", letterSpacing: "-.033em", color: "#a39e9a" }}>
            Research tokenized equities, build a basket and sign every purchase with your own wallet.
          </p>
          <div className="lp-hero-cta" style={{ position: "absolute", left: "0", right: "0", top: "563px", display: "flex", justifyContent: "center", alignItems: "center", gap: "10px" }}>
            <Link className="lp-cta" href="/app" style={{ width: "190px", height: "57px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: "13px", borderRadius: "999px", border: "1px solid rgba(255,255,255,.34)", background: "#0c0b0b", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "18px", letterSpacing: "-.01em" }}>
              Start in paper mode
              <svg width={18} height={12} viewBox="0 0 18 12" fill="none" stroke="#f4f4f6" strokeWidth="1.3" aria-hidden="true">
                <path d="M0 6h17M12 1l5 5-5 5">
                </path>
              </svg>
            </Link>
            <Link className="lp-cta" href="/markets" style={{ width: "154px", height: "47px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "999px", border: "1px solid rgba(255,255,255,.34)", background: "#2a2523", fontSize: "13.5px", fontWeight: "500", letterSpacing: "-.01em" }}>
              Explore markets
            </Link>
          </div>
          <div className="lp-side-card lp-side-back lp-side-lb lp-from-left" aria-hidden="true" style={{ position: "absolute", left: "calc(50% - 660px)", top: "820px", width: "350px", height: "265px", boxSizing: "border-box", borderRadius: "44px", border: "1px solid #2a2a2c", background: "#070708", transformOrigin: "100% 0", transform: "rotate(-10deg)" }}>
          </div>
          <article className="lp-side-card lp-side-l lp-from-left" aria-label="Illustrative basket example" style={{ position: "absolute", left: "calc(50% - 698px)", top: "860px", width: "350px", height: "230px", boxSizing: "border-box", borderRadius: "44px", border: "1px solid #2b2b2e", background: "#09090a", transformOrigin: "100% 0", transform: "rotate(-10deg)" }}>
            <span style={{ position: "absolute", left: "28px", top: "34px", width: "50px", height: "50px", borderRadius: "10px", background: "#1b1b1d", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#eee" strokeWidth="1.8" aria-hidden="true">
                <rect x="3" y="3" width={8} height={8} rx="2">
                </rect>
                <rect x="13" y="3" width={8} height={8} rx="2">
                </rect>
                <rect x="3" y="13" width={8} height={8} rx="2">
                </rect>
                <rect x="13" y="13" width={8} height={8} rx="2">
                </rect>
              </svg>
            </span>
            <span style={{ position: "absolute", left: "92px", top: "30px", fontSize: "22px", letterSpacing: "-.01em", color: "#f0f0f0" }}>
              Sample basket
            </span>
            <span style={{ position: "absolute", left: "92px", top: "62px", fontSize: "14px", color: "#8a8a8e" }}>
              3 assets, weights total 100%
            </span>
            <span style={{ position: "absolute", left: "28px", top: "118px", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "36px", fontWeight: "500", letterSpacing: "-.02em", color: "#f5f5f5" }}>
              40 / 35 / 25
            </span>
            <span style={{ position: "absolute", left: "28px", top: "168px", fontSize: "16px", color: "#77777c" }}>
              Illustrative allocation only
            </span>
          </article>
          <div className="lp-side-card lp-side-back lp-side-rb lp-from-right" aria-hidden="true" style={{ position: "absolute", left: "calc(50% + 320px)", top: "850px", width: "350px", height: "265px", boxSizing: "border-box", borderRadius: "44px", border: "1px solid #2a2a2c", background: "#070708", transformOrigin: "0 0", transform: "rotate(10deg)" }}>
          </div>
          <article className="lp-side-card lp-side-r lp-from-right" aria-label="Recurring investing example" style={{ position: "absolute", left: "calc(50% + 348px)", top: "865px", width: "350px", height: "230px", boxSizing: "border-box", borderRadius: "44px", border: "1px solid #2b2b2e", background: "#09090a", transformOrigin: "0 0", transform: "rotate(10deg)" }}>
            <span style={{ position: "absolute", left: "28px", top: "34px", width: "50px", height: "50px", borderRadius: "10px", background: "#1b1b1d", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#f3f3f3" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.3-5.7">
                </path>
                <path d="M20 4v4.5h-4.5">
                </path>
                <path d="M12 8v4l3 2">
                </path>
              </svg>
            </span>
            <span style={{ position: "absolute", left: "92px", top: "30px", fontSize: "22px", letterSpacing: "-.01em", color: "#f0f0f0" }}>
              Recurring plan
            </span>
            <span style={{ position: "absolute", left: "92px", top: "62px", fontSize: "14px", color: "#8a8a8e" }}>
              Devnet test-token demo
            </span>
            <span style={{ position: "absolute", left: "28px", top: "118px", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "36px", fontWeight: "500", letterSpacing: "-.02em", color: "#f5f5f5" }}>
              Weekly
            </span>
            <span style={{ position: "absolute", left: "28px", top: "168px", fontSize: "16px", color: "#77777c" }}>
              Daily, weekly, biweekly or 30 days
            </span>
          </article>
          <article className="lp-main-card lp-rise" aria-label="Illustrative basket review" style={{ position: "absolute", left: "50%", marginLeft: "-287px", top: "760px", width: "573px", height: "380px", boxSizing: "border-box", borderRadius: "44px", border: "1px solid #3a3a3e", overflow: "hidden", background: "linear-gradient(180deg, rgba(14,14,16,.92) 0%, rgba(26,27,32,.88) 44%, rgba(34,40,54,.92) 57%, #1b1e28 62%, #232833 100%)" }}>
            <div aria-hidden="true" style={{ position: "absolute", left: "180px", top: "0", width: "210px", height: "220px", background: "radial-gradient(ellipse 50% 60% at 50% 70%, rgba(170,172,188,.26), rgba(0,0,0,0))" }}>
            </div>
            <div aria-hidden="true" style={{ position: "absolute", left: "-10px", top: "212px", width: "593px", height: "30px", background: "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(146,164,200,.5), rgba(0,0,0,0))" }}>
            </div>
            <div aria-hidden="true" style={{ position: "absolute", left: "30px", top: "240px", width: "513px", height: "200px", borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: "rgba(9,9,12,.82)", filter: "blur(16px)" }}>
            </div>
            <div aria-hidden="true" style={{ position: "absolute", left: "30px", top: "325px", width: "513px", height: "180px", borderRadius: "50%", background: "linear-gradient(180deg, #e0a56e 0%, #b8706c 5%, #5a78b4 11%, #26324c 22%, #1b2130 40%)", filter: "blur(4px)", opacity: ".85" }}>
            </div>
            <span style={{ position: "absolute", left: "26px", top: "37px", width: "43px", height: "45px", borderRadius: "10px", background: "#1a1a1d", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#f0f0f0" strokeWidth="1.8" aria-hidden="true">
                <rect x="3" y="3" width={8} height={8} rx="2">
                </rect>
                <rect x="13" y="3" width={8} height={8} rx="2">
                </rect>
                <rect x="3" y="13" width={8} height={8} rx="2">
                </rect>
                <rect x="13" y="13" width={8} height={8} rx="2">
                </rect>
              </svg>
            </span>
            <span style={{ position: "absolute", left: "80px", top: "36px", fontSize: "21px", letterSpacing: "-.015em", color: "#f0f0f0" }}>
              Basket review
            </span>
            <span style={{ position: "absolute", left: "80px", top: "65px", fontSize: "13px", color: "#8a8a8e" }}>
              Illustrative, not live data
            </span>
            <span style={{ position: "absolute", left: "222px", top: "37px", height: "22px", boxSizing: "border-box", padding: "0 10px", borderRadius: "999px", background: "#1d3a2a", color: "#5fd68a", fontSize: "12px", lineHeight: "22px", letterSpacing: "-.01em" }}>
              Minimum outputs shown
            </span>
            <span style={{ position: "absolute", left: "27px", top: "148px", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "36px", fontWeight: "500", letterSpacing: "-.03em", color: "#f8f8f8" }}>
              3 assets
            </span>
            <span style={{ position: "absolute", left: "27px", top: "198px", fontSize: "18px", letterSpacing: "-.01em", color: "#8a8a90" }}>
              one transaction first
            </span>
            <svg className="lp-main-chart" role="img" aria-label="Sample allocation: 40, 35 and 25 percent" width={324} height={120} viewBox="0 0 324 120" style={{ position: "absolute", left: "221px", top: "101px", overflow: "visible" }}>
              <g fontSize="9" fill="#a0a0a4">
                <text x="0" y="14">
                  xNVDA
                </text>
                <text x="0" y="50">
                  xAAPL
                </text>
                <text x="0" y="86">
                  xMSFT
                </text>
              </g>
              <g fill="#2a2d33">
                <rect x="48" y="4" width={240} height={14} rx="7">
                </rect>
                <rect x="48" y="40" width={240} height={14} rx="7">
                </rect>
                <rect x="48" y="76" width={240} height={14} rx="7">
                </rect>
              </g>
              <g fill="#7d8088">
                <rect x="48" y="4" width={96} height={14} rx="7">
                </rect>
                <rect x="48" y="40" width={84} height={14} rx="7">
                </rect>
                <rect x="48" y="76" width={60} height={14} rx="7">
                </rect>
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
            <div className="lp-main-low" style={{ position: "absolute", left: "26px", top: "273px", width: "130px", height: "65px", boxSizing: "border-box", padding: "11px 13px", borderRadius: "10px", border: "1px solid #55555a", borderRightColor: "#2b2b2e", background: "rgba(10,10,12,.86)" }}>
              <div style={{ fontSize: "12px", color: "#8a8a8e" }}>
                Custody
              </div>
              <div style={{ marginTop: "7px", fontSize: "17px", letterSpacing: "-.01em", color: "#f5f5f5" }}>
                Your wallet
              </div>
            </div>
            <div className="lp-main-slider" aria-hidden="true" style={{ position: "absolute", left: "164px", top: "305px", width: "262px", height: "1px", background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.65) 40%, rgba(255,255,255,.75) 41%, rgba(255,255,255,.1) 44%, rgba(255,255,255,.08) 100%)" }}>
            </div>
            <div className="lp-main-slider" aria-hidden="true" style={{ position: "absolute", left: "266px", top: "301px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px 2px rgba(255,255,255,.7)" }}>
            </div>
            <div className="lp-main-high" style={{ position: "absolute", left: "425px", top: "273px", width: "120px", height: "65px", boxSizing: "border-box", padding: "11px 12px", borderRadius: "10px", border: "1px solid #55555a", borderLeftColor: "#2b2b2e", background: "rgba(10,10,12,.86)" }}>
              <div style={{ fontSize: "12px", color: "#8a8a8e" }}>
                Basket size
              </div>
              <div style={{ marginTop: "7px", fontSize: "17px", letterSpacing: "-.01em", color: "#f5f5f5" }}>
                2 to 12
              </div>
            </div>
          </article>
        </section>
        <section style={{ paddingTop: "78px", textAlign: "center" }}>
          <p style={{ margin: "0", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "16.5px", lineHeight: "20px", letterSpacing: "-.05em", color: "#8a8a8d" }}>
            Built with
          </p>
          <ul className="lp-logo-row lp-fade-up" aria-label="Built with" style={{ listStyle: "none", padding: "0", width: "720px", maxWidth: "100%", margin: "38px auto 0", display: "flex", alignItems: "center", justifyContent: "center", gap: "36px", height: "34px", color: "#f2f2f2", whiteSpace: "nowrap", WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 12%, #000 88%, transparent 100%)", maskImage: "linear-gradient(90deg, transparent 0%, #000 12%, #000 88%, transparent 100%)", fontSize: "15.9px" }}>
            <li style={{ fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "24px", letterSpacing: "-0.02em" }}>
              Solana
            </li>
            <li style={{ fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "24px", letterSpacing: "-0.02em" }}>
              Jupiter
            </li>
            <li style={{ fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "24px", letterSpacing: "-0.02em" }}>
              xStocks
            </li>
            <li style={{ fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "24px", letterSpacing: "-0.02em" }}>
              Pyth
            </li>
          </ul>
        </section>
        <section id="how-it-works" style={{ paddingTop: "96px", textAlign: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "27px", padding: "0 14px 0 11px", borderRadius: "999px", background: "#2a2a2c", border: "1px solid #39393c", boxSizing: "border-box", fontSize: "12px", fontWeight: "500", color: "#e6e6e6" }}>
            <svg width={13} height={13} viewBox="0 0 13 13" aria-hidden="true">
              <path fillRule="evenodd" d="M6.5 0 L12.5 3.4 V9.6 L6.5 13 L.5 9.6 V3.4 Z M6.5 4.3 a2.2 2.2 0 1 0 .01 0 Z" fill="#fff">
              </path>
            </svg>
            How it works
          </span>
          <h2 className="lp-section-title lp-fade-up" style={{ margin: "26px auto 0", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "54px", lineHeight: "54px", fontWeight: "400", letterSpacing: "-.06em", color: "transparent", background: "linear-gradient(90deg, #4e4e50 20%, #8c8c8e 34%, #fafafa 50%, #8c8c8e 66%, #4e4e50 80%)", WebkitBackgroundClip: "text", backgroundClip: "text" }}>
            Research, build and automate
            <br />
            from one wallet-first interface
          </h2>
          <p style={{ margin: "22px auto 0", padding: "0 16px", maxWidth: "520px", fontSize: "14px", lineHeight: "20px", color: "#b0b0b3" }}>
            Tokenized securities are issuer-defined exposure, not direct brokerage shares. Aroma keeps issuer, route and custody details in front of you before you sign.
          </p>
          <div className="lp-feature-grid" style={{ maxWidth: "1328px", boxSizing: "border-box", margin: "82px auto 0", padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "57px", textAlign: "left" }}>
            <article>
              <div aria-hidden="true" style={{ position: "relative", height: "302px", borderRadius: "20px", background: "#141416", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "46px", top: "56px", width: "500px", height: "300px", boxSizing: "border-box", borderRadius: "26px 26px 0 0", border: "1px solid #3b3b3e", background: "#0c0c0e" }}>
                </div>
                <div style={{ position: "absolute", left: "64px", top: "78px", display: "flex", gap: "8px" }}>
                  <span style={{ height: "24px", padding: "0 12px", borderRadius: "999px", background: "#2a2d33", color: "#eee", fontSize: "11px", lineHeight: "24px" }}>
                    Overview
                  </span>
                  <span style={{ height: "24px", padding: "0 12px", borderRadius: "999px", background: "#1c1c1e", color: "#8a8a8e", fontSize: "11px", lineHeight: "24px" }}>
                    Technicals
                  </span>
                  <span style={{ height: "24px", padding: "0 12px", borderRadius: "999px", background: "#1c1c1e", color: "#8a8a8e", fontSize: "11px", lineHeight: "24px" }}>
                    Fundamentals
                  </span>
                </div>
                <div style={{ position: "absolute", left: "64px", top: "124px", width: "300px", height: "10px", borderRadius: "5px", background: "#2a2d33" }}>
                </div>
                <div style={{ position: "absolute", left: "64px", top: "148px", width: "340px", height: "10px", borderRadius: "5px", background: "#1f2127" }}>
                </div>
                <div style={{ position: "absolute", left: "64px", top: "172px", width: "260px", height: "10px", borderRadius: "5px", background: "#1f2127" }}>
                </div>
                <div style={{ position: "absolute", left: "64px", top: "210px", width: "120px", height: "56px", boxSizing: "border-box", padding: "10px 12px", borderRadius: "8px", border: "1px solid #4d4d51", background: "#0d0d0f" }}>
                  <div style={{ fontSize: "10px", color: "#8a8a8e" }}>
                    News
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#f5f5f5" }}>
                    Where available
                  </div>
                </div>
                <div style={{ position: "absolute", left: "196px", top: "210px", width: "120px", height: "56px", boxSizing: "border-box", padding: "10px 12px", borderRadius: "8px", border: "1px solid #4d4d51", background: "#0d0d0f" }}>
                  <div style={{ fontSize: "10px", color: "#8a8a8e" }}>
                    Data status
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#f5f5f5" }}>
                    Stale stays visible
                  </div>
                </div>
              </div>
              <h3 style={{ display: "flex", alignItems: "center", gap: "14px", margin: "36px 0 0", fontSize: "24.2px", lineHeight: "30px", fontWeight: "400", letterSpacing: ".022em", color: "#f4f4f4" }}>
                <svg width={23} height={23} viewBox="0 0 23 23" aria-hidden="true">
                  <path fillRule="evenodd" d="M6 0h11a6 6 0 0 1 6 6v11a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Z M5 17v2h2v-2Z M9 13v6h2v-6Z M13 15v4h2v-4Z M17 9v10h2V9Z M4 11l5-4 3 2 5-5 1 1-6 6-3-2-4 3Z" fill="#fff">
                  </path>
                </svg>
                Stock research
              </h3>
              <p style={{ margin: "15px 0 0", fontSize: "15.9px", lineHeight: "24px", letterSpacing: "-.005em", color: "#a7a7aa" }}>
                Overview, technicals, fundamentals, news and events in one place, wherever upstream data exists.
              </p>
            </article>
            <article>
              <div aria-hidden="true" style={{ position: "relative", height: "302px", borderRadius: "20px", background: "#161618", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "50%", translate: "-50% 0", top: "40px", width: "min(294px, calc(100% - 24px))", height: "97px", boxSizing: "border-box", borderRadius: "12px", border: "1px solid #222225", background: "#131315" }}>
                  <span style={{ position: "absolute", left: "15px", top: "20px", width: "3px", height: "17px", borderRadius: "2px", background: "#f0b45a" }}>
                  </span>
                  <span style={{ position: "absolute", left: "26px", top: "21px", fontSize: "13px", letterSpacing: ".01em", color: "#a2a2a6" }}>
                    Paper cash
                  </span>
                  <span style={{ position: "absolute", left: "15px", top: "54px", fontSize: "22.5px", letterSpacing: ".035em", color: "#f2f2f2" }}>
                    $10,000
                  </span>
                  <span style={{ position: "absolute", right: "15px", top: "62px", fontSize: "13px", color: "#8f8f93" }}>
                    virtual, no holdings
                  </span>
                </div>
                <div style={{ position: "absolute", left: "50%", translate: "-50% 0", top: "165px", width: "min(294px, calc(100% - 24px))", height: "97px", boxSizing: "border-box", borderRadius: "12px", border: "1px solid #222225", background: "#131315" }}>
                  <span style={{ position: "absolute", left: "15px", top: "20px", width: "3px", height: "17px", borderRadius: "2px", background: "#b7b2ee" }}>
                  </span>
                  <span style={{ position: "absolute", left: "26px", top: "21px", fontSize: "13px", letterSpacing: ".01em", color: "#a2a2a6" }}>
                    Connected wallet
                  </span>
                  <span style={{ position: "absolute", left: "15px", top: "54px", fontSize: "18px", letterSpacing: ".01em", color: "#f2f2f2" }}>
                    Tokens settle to you
                  </span>
                  <span style={{ position: "absolute", right: "15px", top: "62px", fontSize: "13px", color: "#8f8f93" }}>
                  </span>
                </div>
              </div>
              <h3 style={{ display: "flex", alignItems: "center", gap: "14px", margin: "36px 0 0", fontSize: "24.2px", lineHeight: "30px", fontWeight: "400", letterSpacing: ".022em", color: "#f4f4f4" }}>
                <svg width={20} height={23} viewBox="0 0 20 23" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 0l10 3.5v8c0 5.5-4 9.5-10 11.5C4 21 0 17 0 11.5v-8Z M5 11.5l4 4 7-7-1.6-1.6L9 12.3 6.6 10Z" fill="#fff">
                  </path>
                </svg>
                Self-custody by design
              </h3>
              <p style={{ margin: "15px 0 0", fontSize: "15.9px", lineHeight: "24px", letterSpacing: "-.005em", color: "#a7a7aa" }}>
                No custodial vault for mainnet purchases. You review and sign each transaction, and outputs settle to your wallet.
              </p>
            </article>
            <article>
              <div aria-hidden="true" style={{ position: "relative", height: "302px", borderRadius: "20px", background: "#1f1f21", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: "32px", top: "27px", width: "500px", height: "300px", boxSizing: "border-box", borderRadius: "10px", border: "1px solid #2b2b2e", background: "#161618" }}>
                </div>
                <span style={{ position: "absolute", left: "52px", top: "40px", fontSize: "13.5px", fontWeight: "500", letterSpacing: "-.005em", color: "#f0f0f0" }}>
                  Sample allocation
                </span>
                <div style={{ position: "absolute", left: "32px", right: "0", top: "71px", height: "1px", background: "#29292c" }}>
                </div>
                <div style={{ position: "absolute", left: "51px", top: "86px", width: "400px", height: "38px", borderRadius: "7px", background: "#29292d" }}>
                </div>
                <div style={{ position: "absolute", left: "51px", top: "138px", width: "400px", height: "38px", borderRadius: "7px", background: "#29292d" }}>
                </div>
                <div style={{ position: "absolute", left: "51px", top: "190px", width: "400px", height: "38px", borderRadius: "7px", background: "#29292d" }}>
                </div>
                <div style={{ position: "absolute", left: "51px", top: "242px", width: "400px", height: "38px", borderRadius: "7px", background: "#29292d" }}>
                </div>
                <span style={{ position: "absolute", left: "65px", top: "98px", fontSize: "11.5px", fontWeight: "500", color: "#eee" }}>
                  NVIDIA (xNVDA)
                </span>
                <span style={{ position: "absolute", left: "65px", top: "150px", fontSize: "11.5px", fontWeight: "500", color: "#eee" }}>
                  Apple (xAAPL)
                </span>
                <span style={{ position: "absolute", left: "65px", top: "202px", fontSize: "11.5px", fontWeight: "500", color: "#eee" }}>
                  Microsoft (xMSFT)
                </span>
                <span style={{ position: "absolute", left: "65px", top: "254px", fontSize: "11.5px", fontWeight: "500", color: "#eee" }}>
                  Tesla (xTSLA)
                </span>
                <span style={{ position: "absolute", left: "225px", top: "97px", fontSize: "12px", fontWeight: "500", color: "#8682d8" }}>
                  40%
                </span>
                <span style={{ position: "absolute", left: "225px", top: "149px", fontSize: "12px", fontWeight: "500", color: "#8682d8" }}>
                  30%
                </span>
                <span style={{ position: "absolute", left: "225px", top: "201px", fontSize: "12px", fontWeight: "500", color: "#8682d8" }}>
                  20%
                </span>
                <span style={{ position: "absolute", left: "225px", top: "253px", fontSize: "12px", fontWeight: "500", color: "#8682d8" }}>
                  10%
                </span>
                <div style={{ position: "absolute", left: "280px", top: "102px", width: "150px", height: "6px", borderRadius: "3px", background: "#3a3a42" }}>
                  <div style={{ width: "100%", height: "6px", borderRadius: "3px", background: "#42b895" }}>
                  </div>
                </div>
                <div style={{ position: "absolute", left: "280px", top: "154px", width: "150px", height: "6px", borderRadius: "3px", background: "#3a3a42" }}>
                  <div style={{ width: "75%", height: "6px", borderRadius: "3px", background: "#42b895" }}>
                  </div>
                </div>
                <div style={{ position: "absolute", left: "280px", top: "206px", width: "150px", height: "6px", borderRadius: "3px", background: "#3a3a42" }}>
                  <div style={{ width: "50%", height: "6px", borderRadius: "3px", background: "#42b895" }}>
                  </div>
                </div>
                <div style={{ position: "absolute", left: "280px", top: "258px", width: "150px", height: "6px", borderRadius: "3px", background: "#3a3a42" }}>
                  <div style={{ width: "25%", height: "6px", borderRadius: "3px", background: "#42b895" }}>
                  </div>
                </div>
              </div>
              <h3 style={{ display: "flex", alignItems: "center", gap: "14px", margin: "36px 0 0", fontSize: "24.2px", lineHeight: "30px", fontWeight: "400", letterSpacing: ".022em", color: "#f4f4f4" }}>
                <svg width={18} height={23} viewBox="0 0 18 23" aria-hidden="true">
                  <path d="M11 0 L1 13 H8 L6 23 L17 9 H10 Z" fill="#fff">
                  </path>
                </svg>
                Baskets and recurring
              </h3>
              <p style={{ margin: "15px 0 0", fontSize: "15.9px", lineHeight: "24px", letterSpacing: "-.005em", color: "#a7a7aa" }}>
                Build a basket of 2 to 12 assets. Recurring investing is a devnet test-token demo; mainnet recurring is not available.
              </p>
            </article>
          </div>
        </section>
        <section style={{ paddingTop: "242px", paddingBottom: "40px", textAlign: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "27px", padding: "0 14px 0 11px", borderRadius: "999px", background: "#1f1f21", border: "1px solid #39393c", boxSizing: "border-box", fontSize: "12px", fontWeight: "500", color: "#e6e6e6" }}>
            <svg width={11} height={13} viewBox="0 0 18 23" aria-hidden="true">
              <path d="M11 0 L1 13 H8 L6 23 L17 9 H10 Z" fill="#fff">
              </path>
            </svg>
            Tools
          </span>
          <h2 className="lp-section-title lp-fade-up" style={{ margin: "27px auto 0", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "54px", lineHeight: "54px", fontWeight: "400", letterSpacing: "-.06em", color: "transparent", background: "linear-gradient(90deg, #5c5c5e 28%, #8c8c8e 38%, #fafafa 50%, #8c8c8e 62%, #5c5c5e 72%)", WebkitBackgroundClip: "text", backgroundClip: "text" }}>
            Everything you need
            <br />
            before you sign
          </h2>
          <p style={{ margin: "20px auto 0", padding: "0 16px", fontSize: "14px", lineHeight: "20px", color: "#c0c0c3" }}>
            Browse, build and practice first. Check every debit, minimum output and fee when you are ready.
          </p>
          <div className="lp-tool-grid" style={{ maxWidth: "1328px", boxSizing: "border-box", margin: "49px auto 0", padding: "0 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: "2px", textAlign: "left" }}>
            <article className="lp-tool-card" style={{ position: "relative", height: "290px", boxSizing: "border-box", padding: "72px 32px 0", borderRadius: "6px", border: "1px solid #1a1a1c", background: "linear-gradient(100deg, #040404 30%, #101011 100%)" }}>
              <div aria-hidden="true" style={{ position: "absolute", left: "30%", right: "0", top: "-1px", height: "1px", background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.55) 60%, rgba(255,255,255,.1))" }}>
              </div>
              <svg width={38} height={38} viewBox="0 0 38 38" fill="none" stroke="#f4f4f4" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <rect x="2" y="2" width={34} height={34} rx="9">
                </rect>
                <path d="M11 16v6M19 12v14M27 16v6">
                </path>
              </svg>
              <h3 style={{ margin: "28px 0 0", fontSize: "20px", lineHeight: "26px", fontWeight: "400", letterSpacing: "-.005em", color: "#e8e8e8" }}>
                Evidence-led market data
              </h3>
              <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: "22px", color: "#8f8f93" }}>
                Prices and breadth come from observed data. Unavailable and stale states are shown, never filled in.
              </p>
            </article>
            <article className="lp-tool-card" style={{ position: "relative", height: "290px", boxSizing: "border-box", padding: "72px 32px 0", borderRadius: "6px", border: "1px solid #0f0f10", background: "#040404" }}>
              <svg width={40} height={38} viewBox="0 0 40 38" fill="none" stroke="#f4f4f4" strokeWidth="2.2" aria-hidden="true">
                <rect x="2" y="3" width={32} height={24} rx="6">
                </rect>
                <path d="M7 31c1 3 3 4 6 4h16c6 0 9-3 9-8V14c0-3-1-5-3-6">
                </path>
                <circle cx="18" cy="15" r="5">
                </circle>
                <path d="M9 11v8M27 11v8" strokeLinecap="round">
                </path>
              </svg>
              <h3 style={{ margin: "28px 0 0", fontSize: "20px", lineHeight: "26px", fontWeight: "400", letterSpacing: "-.005em", color: "#e8e8e8" }}>
                Wallet-based portfolio
              </h3>
              <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: "22px", color: "#8f8f93" }}>
                Mainnet values come from wallet balances and available prices. Cost basis is not inferred from balances.
              </p>
            </article>
            <article className="lp-tool-card" style={{ position: "relative", height: "290px", boxSizing: "border-box", padding: "72px 32px 0", borderRadius: "6px", border: "1px solid #0f0f10", background: "#040404" }}>
              <svg width={38} height={38} viewBox="0 0 38 38" fill="none" stroke="#f4f4f4" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M24 4H11a9 9 0 0 0-9 9v14a9 9 0 0 0 9 9h14a9 9 0 0 0 9-9V15">
                </path>
                <circle cx="31" cy="7" r="5">
                </circle>
                <path d="M10 19h9M10 27h16">
                </path>
              </svg>
              <h3 style={{ margin: "28px 0 0", fontSize: "20px", lineHeight: "26px", fontWeight: "400", letterSpacing: "-.005em", color: "#e8e8e8" }}>
                Paper and devnet practice
              </h3>
              <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: "22px", color: "#8f8f93" }}>
                Start with $10,000 virtual cash, or try the devnet recurring demo with test tokens. Neither is a forecast of real execution.
              </p>
            </article>
          </div>
        </section>
        <footer style={{ padding: "56px 16px 64px", textAlign: "center", borderTop: "1px solid #141416" }}>
          <Link className="lp-cta" href="/app" style={{ display: "inline-flex", width: "190px", height: "52px", alignItems: "center", justifyContent: "center", borderRadius: "999px", border: "1px solid rgba(255,255,255,.34)", background: "#0c0b0b", fontFamily: "var(--lp-font-display), Helvetica, Arial, sans-serif", fontSize: "16px" }}>
            Launch Aroma
          </Link>
          <nav aria-label="Footer" style={{ marginTop: "32px", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px 28px", fontSize: "13px" }}>
            <Link href="/markets" style={{ color: "#a7a7aa" }}>
              Markets
            </Link>
            <Link href="/baskets" style={{ color: "#a7a7aa" }}>
              Baskets
            </Link>
            <Link href="/sip" style={{ color: "#a7a7aa" }}>
              Recurring
            </Link>
            <Link href="/privacy" style={{ color: "#a7a7aa" }}>
              Privacy
            </Link>
            <Link href="/terms" style={{ color: "#a7a7aa" }}>
              Terms
            </Link>
            <Link href="/settings" style={{ color: "#a7a7aa" }}>
              Settings
            </Link>
          </nav>
          <p style={{ margin: "24px auto 0", maxWidth: "640px", fontSize: "12px", lineHeight: "18px", color: "#77777a" }}>
            Tokenized securities carry issuer, market, network and execution risk. Aroma does not guarantee fills. Examples on this page are illustrative and not live data.
          </p>
        </footer>
      </div>
    </main>
  );
}
