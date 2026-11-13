import type { ReactNode } from "react";
import { themeInitScript } from "@aroma/ui/theme";
import { SiteFooter } from "@/features/shared/components/SiteFooter";
import { SiteHeader } from "@/features/shared/components/SiteHeader";
import { assertV1Enabled } from "@/features/shared/v1";
import "../../aroma-ui.v4.css";

/**
 * v1 marketing pages (landing, privacy, terms) under the temporary `/v1` prefix. The `(marketing)`
 * group layout is empty, so this layout loads the Tailwind v4 entry and theme script itself.
 */
export default function V1MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  assertV1Enabled();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <div className="flex min-h-dvh flex-col bg-bg text-ink">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </div>
    </>
  );
}
