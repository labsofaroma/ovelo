import type { ReactNode } from "react";
import { assertV1Enabled } from "@/features/shared/v1";

export const dynamic = "force-dynamic";

/** Gate before any read (the page also gates: Next renders layouts and pages in parallel). */
export default function InvestLayout({ children }: { children: ReactNode }) {
  assertV1Enabled();
  return children;
}
