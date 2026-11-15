import type { Metadata } from "next";
import Link from "next/link";
import { routes } from "@/features/shared/routes";
import { GradientHeading } from "@ovelo/ui";
import {
  eyebrowPill,
  linkButtonSmall,
  pageContainer,
} from "@/features/shared/styles";

// Rendered per request (nonce CSP), like every v1 page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Not available in your location",
  robots: { index: false, follow: false },
};

/**
 * M9 compliance gate: middleware rewrites v1 pages here for a restricted visitor ONLY when the
 * policy sets browse to `block` (OVELO_COMPLIANCE_BROWSE=block; the default is browse-only).
 * Copy is placeholder pending counsel's final text.
 */
export default function RestrictedPage() {
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex justify-center pt-4 pb-6 md:pt-10`}
    >
      <section className="flex w-full max-w-3xl flex-col items-center gap-5 rounded-[1.75rem] border border-line bg-surface px-6 py-12 text-center edge-highlight md:rounded-hero md:px-14 md:py-16">
        <p className={eyebrowPill}>Location check</p>
        <GradientHeading as="h1" size="page">
          Ovelo is not available in your location
        </GradientHeading>
        <p className="max-w-[56ch] text-body leading-body text-muted">
          Based on your network location, this service is not offered where you
          are. This check uses your network location only; it is not identity
          verification.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link className={linkButtonSmall.secondary} href={routes.terms}>
            Terms
          </Link>
          <Link className={linkButtonSmall.secondary} href={routes.privacy}>
            Privacy
          </Link>
        </div>
      </section>
    </main>
  );
}
