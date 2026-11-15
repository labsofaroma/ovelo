import type { ReactNode } from "react";
import { SiteFooter } from "@/features/shared/components/SiteFooter";

/** The landing page draws its own header (Landing.tsx); only the shared footer is added here. */
export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
