import { createActionHeaders } from "@solana/actions";

/**
 * Solana Actions response headers (spec 2.4): CORS, `X-Action-Version`, `X-Blockchain-Ids`, the
 * headers a Blink client may read, and no caching. Shared by the v1 Action routes and
 * `/actions.json` (M9 Step 1: moved here from the prototype's recurring-actions.ts).
 * Pure: no environment, no server-only import.
 */
export type ActionChain = "mainnet" | "devnet";

export function actionHeaders(
  chain: ActionChain = "mainnet",
): Record<string, string> {
  return {
    ...createActionHeaders({ chainId: chain, actionVersion: "2.4" }),
    "Access-Control-Expose-Headers":
      "X-Blockchain-Ids, X-Action-Version, Retry-After",
    "Cache-Control": "no-store",
  };
}
