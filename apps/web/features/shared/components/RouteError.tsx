"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { routes } from "../routes";
import { linkButton, pageContainer, textLink } from "../styles";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}

/**
 * Shared body for v1 `error.tsx` files. Never renders `error.message`: in production Next replaces
 * it anyway, and in development it may hold upstream text. The digest lets support match logs.
 */
export function RouteError({
  error,
  reset,
  title = "This page could not be loaded",
}: RouteErrorProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-4 py-12`}
    >
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-page font-semibold max-md:text-page-mobile"
      >
        {title}
      </h1>
      <p className="max-w-2xl text-body text-muted">
        Something went wrong while preparing this page. No market figures are
        shown because none could be verified. Try again, or come back in a few
        minutes.
      </p>
      {error.digest ? (
        <p className="text-caption text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className={linkButton.primary} onClick={reset}>
          Try again
        </button>
        <Link className={textLink} href={routes.markets}>
          Go to markets
        </Link>
      </div>
    </main>
  );
}
