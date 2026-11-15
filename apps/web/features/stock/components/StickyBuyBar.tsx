"use client";

import { Button, StickyActionBar } from "@ovelo/ui";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Floating "Buy" bar (redesign StickyBuyBar). Shown only after hydration and while the #trade
 * card is off screen; its button scrolls to the card and focuses the amount field. It carries
 * no figure of its own: the detail line is passed in with its source.
 */
export function StickyBuyBar({
  label,
  detail,
  targetId = "trade",
}: {
  label: string;
  detail?: ReactNode;
  targetId?: string;
}) {
  // Starts "in view" so the server HTML and the first client render have no bar.
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.05 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);
  if (inView) return null;

  const goToTicket = () => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
    target
      .querySelector<HTMLInputElement>("[data-ticket-amount]")
      ?.focus({ preventScroll: true });
  };

  return (
    <StickyActionBar label={label}>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-display text-small font-medium text-ink">
          {label}
        </span>
        {detail ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-muted">
            {detail}
          </span>
        ) : null}
      </div>
      <Button variant="solid" className="shrink-0" onClick={goToTicket}>
        Buy
      </Button>
    </StickyActionBar>
  );
}
