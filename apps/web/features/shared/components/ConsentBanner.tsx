"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OPEN_PRIVACY_EVENT } from "./PrivacyChoicesButton";
import { routes } from "../routes";

/**
 * v1 consent (replaces the prototype's global PrivacyChoices on /v1). Same storage key and open
 * event, so a choice made on either surface carries over. Analytics stay off unless the visitor
 * opts in, the deployment configures a Plausible domain, and no Do-Not-Track / GPC signal is set.
 * Only the route category is sent: no wallet, order, search or referrer data.
 */
const KEY = "aroma.privacy.v1";
const DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "";

function readChoice(): boolean | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      saved &&
      typeof saved === "object" &&
      "analytics" in saved &&
      typeof saved.analytics === "boolean" &&
      "expiresAt" in saved &&
      typeof saved.expiresAt === "number" &&
      saved.expiresAt > Date.now()
    )
      return saved.analytics;
  } catch {
    /* blocked storage: ask again */
  }
  return null;
}

function category(path: string): string {
  return path
    .replace(/^\/v1\/stock\/[^/]+$/, "/v1/stock/detail")
    .replace(/^\/v1\/basket\/[^/]+$/, "/v1/basket/detail");
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
  return (
    <section
      aria-labelledby="consent-title"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-panel border border-line bg-surface p-4 text-small shadow-float sm:inset-x-auto sm:right-4"
    >
      <h2 id="consent-title" className="font-semibold text-ink">
        Your data, your choice
      </h2>
      <p className="mt-1 text-muted">
        Essential storage keeps preferences working.{" "}
        {DOMAIN
          ? "Usage analytics stay off unless you opt in."
          : "This deployment uses essential storage only."}{" "}
        <Link className="underline focus-ring" href={routes.privacy}>
          Privacy policy
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save(false)}
          className="rounded-control border border-border-strong px-3 py-1.5 font-semibold focus-ring"
        >
          Essential only
        </button>
        {DOMAIN && (
          <button
            type="button"
            onClick={() => save(true)}
            className="rounded-control bg-accent px-3 py-1.5 font-semibold text-accent-ink focus-ring"
          >
            Allow analytics
          </button>
        )}
      </div>
    </section>
  );
}
