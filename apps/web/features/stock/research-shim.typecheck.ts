/**
 * Compile-time drift check for `research-service.strict.d.ts`. Under the MAIN tsconfig the alias
 * below resolves to the real lib/sdk module, so both assignments fail if the shim's signature
 * stops matching. (Under the strict tsconfig both sides are the shim, which is trivially true.)
 * Never imported at runtime.
 */
import type { getStockResearch as Shim } from "./research-service.strict";
import type { getStockResearch as Real } from "@/lib/sdk/research/service";

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type ShimMatchesSdk = Assert<Same<typeof Shim, typeof Real>>;
