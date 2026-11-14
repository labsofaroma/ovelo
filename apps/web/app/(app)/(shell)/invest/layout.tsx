import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

/** Gate before any read (the page also gates: Next renders layouts and pages in parallel). */
export default function InvestLayout({ children }: { children: ReactNode }) {
  return children;
}
