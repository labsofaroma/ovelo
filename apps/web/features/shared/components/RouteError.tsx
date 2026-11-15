"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { GradientHeading, Glow, Grain } from "@ovelo/ui";
import { routes } from "../routes";
import { eyebrowPill, linkButton, pageContainer } from "../styles";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  /** The way out besides "Try again". Default: markets (the markets page itself goes home). */
  escape?: { href: string; label: string };
}

/**
 * Shared body for v1 `error.tsx` files. Never renders `error.message`: in production Next replaces
 * it anyway, and in development it may hold upstream text. The digest lets support match logs.
 */
export function RouteError({
  error,
  reset,
  title = "This page could not be loaded",
  escape = { href: routes.markets, label: "Go to markets" },
}: RouteErrorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <main id="main-content" className={`${pageContainer} py-4`}>
      <section className="relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-[1.75rem] border border-line bg-panel-gradient px-6 py-14 text-center edge-highlight md:rounded-hero md:px-12 md:py-20">
        <Glow />
        <Grain />
        <p className={eyebrowPill}>Something went wrong</p>
        <GradientHeading
          ref={heading}
          tabIndex={-1}
          as="h1"
          size="page"
          className="outline-none"
        >
          {title}
        </GradientHeading>
        <p className="max-w-[52ch] text-body leading-body text-muted">
          Something went wrong while preparing this page. No market figures are
          shown because none could be verified. Try again, or come back in a few
          minutes.
        </p>
        {error.digest ? (
          <p className="text-caption text-muted">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <button type="button" className={linkButton.primary} onClick={reset}>
            Try again
          </button>
          <Link className={linkButton.secondary} href={escape.href}>
            {escape.label}
          </Link>
        </div>
      </section>
    </main>
  );
}
