"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@ovelo/ui";
import { CONSENT_KEY, readConsent } from "../analytics";
import { OPEN_PRIVACY_EVENT } from "./PrivacyChoicesButton";
import { routes } from "../routes";
import { linkButtonSmall, textLink } from "../styles";

/** Pages drawn outside the app frame, so no phone tab bar to clear. */
const OUTSIDE_SHELL = new Set<string>([
  routes.home,
  routes.privacy,
  routes.terms,
  "/restricted",
]);

/**
 * v1 consent (replaced the prototype's global PrivacyChoices). Same storage key and open
 * event, so a choice made on either surface carries over. Analytics stay off unless the visitor
 * opts in, the deployment configures a Plausible domain, and no Do-Not-Track / GPC signal is set.
 * Only the route category is sent: no wallet, order, search or referrer data.
 */
const KEY = CONSENT_KEY;
const DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "";
const readChoice = readConsent;

function category(path: string): string {
  return path
    .replace(/^\/stock\/[^/]+$/, "/stock/detail")
    .replace(/^\/basket\/(?!new$)[^/]+$/, "/basket/detail");
}

export function ConsentBanner() {
  const pathname = usePathname() ?? "";
  const [choice, setChoice] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const current = readChoice();
    setChoice(current);
    setOpen(current === null);
    const show = () => setOpen(true);
    window.addEventListener(OPEN_PRIVACY_EVENT, show);
    return () => window.removeEventListener(OPEN_PRIVACY_EVENT, show);
  }, []);

  useEffect(() => {
    const signal =
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true;
    if (!choice || !DOMAIN || DOMAIN !== location.hostname || signal) return;
    if (last.current === pathname) return;
    last.current = pathname;
    void fetch("https://plausible.io/api/event", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
      body: JSON.stringify({
        name: "pageview",
        domain: DOMAIN,
        url: `https://${DOMAIN}${category(pathname)}`,
      }),
    }).catch(() => {});
  }, [choice, pathname]);

  const save = (analytics: boolean) => {
    setChoice(analytics);
    setOpen(false);
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ analytics, expiresAt: Date.now() + 180 * 86_400_000 }),
      );
    } catch {
      /* the choice applies for this visit */
    }
  };

  if (!open) return null;
  const inShell = !OUTSIDE_SHELL.has(pathname);
  return (
    <section
      aria-labelledby="consent-title"
      className={cn(
        "fixed inset-x-4 z-toast mx-auto flex max-w-xl flex-col gap-4 rounded-panel border border-line bg-raised-2 p-5 text-ink shadow-float edge-highlight md:inset-x-auto md:right-6 md:bottom-6 md:mx-0 md:w-[30rem]",
        inShell
          ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6"
          : "bottom-4",
      )}
    >
      <div className="flex flex-col gap-2">
        <h2
          id="consent-title"
          className="flex items-center gap-2 font-display text-title text-ink"
        >
          <ShieldCheck aria-hidden="true" className="size-4.5 text-muted" />
          Your data, your choice
        </h2>
        <p className="text-small leading-body text-muted">
          Essential storage keeps preferences working.{" "}
          {DOMAIN
            ? "Usage analytics stay off unless you opt in."
            : "This deployment uses essential storage only."}{" "}
          <Link className={textLink} href={routes.privacy}>
            Privacy policy
          </Link>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save(false)}
          className={linkButtonSmall.secondary}
        >
          {/* With no analytics configured there is nothing to choose: just acknowledge. */}
          {DOMAIN ? "Essential only" : "Got it"}
        </button>
        {DOMAIN && (
          <button
            type="button"
            onClick={() => save(true)}
            className={linkButtonSmall.primary}
          >
            Allow analytics
          </button>
        )}
      </div>
    </section>
  );
}
