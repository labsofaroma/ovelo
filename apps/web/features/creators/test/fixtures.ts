import { AppError } from "@/server/errors";
import type { BasketPublish } from "../schema";
import type { AssetRegistry } from "../server";

export const MINT_A = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
export const MINT_B = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
export const MINT_C = "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ";
export const UNLISTED = "So11111111111111111111111111111111111111112";
export const registry: AssetRegistry = new Map([
  [MINT_A, { symbol: "AAPLx" }],
  [MINT_B, { symbol: "NVDAx" }],
  [MINT_C, { symbol: "TSLAx" }],
]);
/** Opaque wallet ids: the service trusts the route to have validated and verified the wallet. */
export const ALICE = "A1iceWa11et1111111111111111111111111111111";
export const BOB = "BobWa11et11111111111111111111111111111111";
export const STRANGER = "StrangerWa11et111111111111111111111111111";
export const NOW = new Date("2026-11-13T12:00:00.000Z");

let idCounter = 0;
export const newId = () =>
  `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;
let tickerCounter = 0;
export const ticker = () => `TK${++tickerCounter}`;

export const content = (
  overrides: Partial<BasketPublish> = {},
): BasketPublish => ({
  name: "Chips and cars",
  ticker: ticker(),
  description: "Semis and EVs",
  allocations: [
    { mint: MINT_A, weightBps: 3334 },
    { mint: MINT_B, weightBps: 3333 },
    { mint: MINT_C, weightBps: 3333 },
  ],
  ...overrides,
});

/** "CODE:detail" for an AppError, "ZodError" for a schema refusal, "ok" otherwise. */
export async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof AppError) return `${error.code}:${error.detail}`;
    if (error instanceof Error && error.name === "ZodError") return "ZodError";
    throw error;
  }
}
