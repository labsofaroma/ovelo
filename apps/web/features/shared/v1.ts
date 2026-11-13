import "server-only";
import { notFound } from "next/navigation";
import { isV1Enabled } from "@/server/env";
export { V1 } from "./routes";

/**
 * v1 pages live under a temporary `/v1` prefix (the prototype still owns `/`, `/markets`, ...)
 * and exist only when AROMA_V1_ENABLED=true, like `/ui-preview` (REWRITE-PLAN §7, M3 decision 1).
 * Call it in every v1 layout AND page: Next renders them in parallel, so a page must not rely on
 * its layout having thrown first. M7 removes the prefix and this gate.
 */
export function assertV1Enabled(): void {
  if (!isV1Enabled()) notFound();
}
