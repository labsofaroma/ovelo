/**
 * TEMPORARY typing shim, strict tsconfig only (M3-SDK-REQUESTS.md #1).
 *
 * `lib/sdk/research/service.ts` imports `research/bars.ts`, which has 16 errors under
 * `noUncheckedIndexedAccess`. The strict project would type-check it through any import, and M3
 * must not edit lib/sdk. `tsconfig.strict.json` maps `@/lib/sdk/research/service` to this file;
 * Next, Vitest and the main tsconfig still resolve the real module, and
 * `research-shim.typecheck.ts` fails the main typecheck if this signature drifts from it.
 * Delete this file and the `paths` entry once M2 makes bars.ts strict-clean.
 */
import type {
  ResearchAsset,
  ResearchOptions,
  StockResearch,
} from "@/lib/sdk/research/types";

export declare function getStockResearch(
  asset: ResearchAsset,
  options?: ResearchOptions,
): Promise<StockResearch>;
