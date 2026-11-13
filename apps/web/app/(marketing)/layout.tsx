import type { ReactNode } from "react";

/**
 * v1 marketing surface (REWRITE-PLAN §4): landing, privacy and terms as static/ISR pages.
 * M0 ships only this empty layout. It has no `page.tsx`, so it adds no route and renders
 * nothing; the prototype landing page at `/` keeps serving until M7.
 */
export default function MarketingGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
