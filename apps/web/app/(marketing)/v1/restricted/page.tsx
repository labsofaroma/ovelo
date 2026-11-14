import type { Metadata } from "next";
import Link from "next/link";
import { routes } from "@/features/shared/routes";
import { pageContainer, textLink } from "@/features/shared/styles";
import { assertV1Enabled } from "@/features/shared/v1";

// Rendered per request (nonce CSP), like every v1 page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Not available in your location",
  robots: { index: false, follow: false },
};

/**
 * M9 compliance gate: middleware rewrites v1 pages here for a restricted visitor ONLY when the
 * policy sets browse to `block` (AROMA_COMPLIANCE_BROWSE=block; the default is browse-only).
 * Copy is placeholder pending counsel's final text.
 */
export default function RestrictedPage() {
  assertV1Enabled();
  return (
    <main id="main-content" className={`${pageContainer} py-12`}>
      <h1 className="text-page font-semibold max-md:text-page-mobile">
        Aroma is not available in your location
      </h1>
      <p className="mt-4 max-w-prose text-body">
        Based on your network location, this service is not offered where you
        are. This check uses your network location only; it is not identity
        verification.
      </p>
      <p className="mt-4 text-small">
        <Link className={textLink} href={routes.terms}>
          Terms
        </Link>{" "}
        ·{" "}
        <Link className={textLink} href={routes.privacy}>
          Privacy
        </Link>
      </p>
    </main>
  );
}
