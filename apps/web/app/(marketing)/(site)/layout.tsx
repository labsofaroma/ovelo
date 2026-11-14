import type { ReactNode } from "react";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";

/**
 * Marketing pages (landing, privacy, terms; M9: at the root, formerly under `/v1`). The `(marketing)`
 * root layout loads the Tailwind v4 entry and the theme script (M4).
 */
export default function V1MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
