import type { ReactNode } from "react";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";
import { assertV1Enabled } from "@/features/shared/v1";

/**
 * v1 product pages under the temporary `/v1` prefix (M3 decision 1). The `(app)` group layout
 * above already loads the Tailwind v4 entry and the theme script.
 */
export default function V1AppLayout({ children }: { children: ReactNode }) {
  assertV1Enabled();
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
