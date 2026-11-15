import type { ReactNode } from "react";
import { Glow, Grain } from "@ovelo/ui";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";

/**
 * Marketing pages outside the app frame (privacy, terms, restricted; M9: at the root, formerly
 * under `/v1`). The `(marketing)` root layout loads the Tailwind v4 entry and the theme script
 * (M4). The glow and grain are decorative and sit behind everything.
 */
export default function V1MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-bg text-ink">
      <Glow className="h-[36rem]" />
      <Grain />
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
