import "server-only";
import { submitDeps } from "@/features/trade/server/deps";
import { tradeOutcome } from "@/features/trade/server/outcome";
import { getDb } from "@/server/db/client";
import { jupiterPrice, type PriceLookup } from "./notional";
import type { CapsDb } from "./store";

/**
 * Production wiring for the W3 caps. Postgres only (no in-memory fallback): without a database
 * every capped request fails closed (TRADE_CAP_UNAVAILABLE).
 */
export type CapsDeps = {
  env(): Record<string, string | undefined>;
  db(): CapsDb;
  price: PriceLookup;
  outcome(requestId: string): Promise<"confirmed" | "failed" | "open">;
  now(): Date;
};

const defaults: CapsDeps = {
  env: () => process.env,
  db: () => getDb() as unknown as CapsDb,
  price: jupiterPrice,
  outcome: (requestId) => tradeOutcome(requestId, submitDeps()),
  now: () => new Date(),
};

let overrides: Partial<CapsDeps> = {};

export function capsDeps(): CapsDeps {
  return { ...defaults, ...overrides };
}

export function setCapsDepsForTests(next: Partial<CapsDeps>): void {
  overrides = next;
}
