import type { ReactNode } from "react";
import { BetaBanner } from "@/features/beta/components/BetaBanner";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { AppShell } from "@/features/shell/AppShell";

/**
 * Product pages, drawn inside the app frame (left sidebar on wide screens, tab bar on phones). The
 * `(app)` group layout above already loads the Tailwind v4 entry and the theme script.
 */
export default function V1AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell banner={<BetaBanner />} footer={<SiteFooter />}>
      {children}
    </AppShell>
  );
}
