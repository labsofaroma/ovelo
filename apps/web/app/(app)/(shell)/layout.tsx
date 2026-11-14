import type { ReactNode } from "react";
import { BetaBanner } from "@/features/beta/components/BetaBanner";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";
import { assertV1Enabled } from "@/features/shared/v1";

/**
 * Product pages (M9: at the root; they lived under a temporary `/v1` prefix until then). The `(app)` group layout
 * above already loads the Tailwind v4 entry and the theme script.
 */
export default function V1AppLayout({ children }: { children: ReactNode }) {
  assertV1Enabled();
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <BetaBanner />
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
