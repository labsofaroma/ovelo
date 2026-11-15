import type { Metadata } from "next";
import { Glow, Grain } from "@ovelo/ui";
import { NotFound } from "@/features/shared/components/NotFound";
import { RootDocument } from "@/features/shared/components/RootDocument";
import { siteUrl } from "@/features/shared/site";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";
import "./ovelo-ui.css";

/**
 * Unmatched URLs (experimental.globalNotFound). There is no top-level layout to wrap a 404, so
 * Next renders this document on its own. M9 Step 1: the v1 shell and tokens instead of the
 * prototype's 404 page and global CSS.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Page not found | Ovelo",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <RootDocument>
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg text-ink">
        <Glow />
        <Glow tone="warm" className="opacity-60" />
        <Grain />
        <SiteHeader />
        <div className="flex-1">
          <NotFound />
        </div>
        <SiteFooter />
      </div>
    </RootDocument>
  );
}
