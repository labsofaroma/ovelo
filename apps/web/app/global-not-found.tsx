import type { Metadata } from "next";
import { NotFound } from "@/features/shared/components/NotFound";
import { RootDocument } from "@/features/shared/components/RootDocument";
import { siteUrl } from "@/features/shared/site";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";
import "./aroma-ui.css";

/**
 * Unmatched URLs (experimental.globalNotFound). There is no top-level layout to wrap a 404, so
 * Next renders this document on its own. M9 Step 1: the v1 shell and tokens instead of the
 * prototype's 404 page and global CSS.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Page not found | Aroma",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <RootDocument>
      <div className="flex min-h-dvh flex-col bg-bg text-ink">
        <SiteHeader />
        <div className="flex-1">
          <NotFound />
        </div>
        <SiteFooter />
      </div>
    </RootDocument>
  );
}
