import "server-only";
import { notFound } from "next/navigation";
import { isV1Enabled } from "@/server/env";

/**
 * v1 pages exist only when AROMA_V1_ENABLED=true (REWRITE-PLAN §7, M3 decision 1). Call it in
 * every layout AND page: Next renders them in parallel, so a page must not rely on its layout
 * having thrown first. M9 Step 5 removes the flag and this gate.
 */
export function assertV1Enabled(): void {
  if (!isV1Enabled()) notFound();
}
