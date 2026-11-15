import type { ReactNode } from "react";

/**
 * The landing page draws its own header (Landing.tsx) and, by the owner's choice, no site footer.
 * Terms and Privacy stay reachable from the consent banner and every app page's footer.
 */
export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-bg text-ink">{children}</div>;
}
