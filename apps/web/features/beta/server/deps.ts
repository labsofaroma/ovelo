import "server-only";
import {
  memoryChallengeStore,
  redisChallengeStore,
} from "@/features/creators/http";
import { localStores } from "@/features/trade/server/local";
import type { ChallengeStore } from "@/server/auth/creator";
import { getDb } from "@/server/db/client";
import { requireRedis } from "@/server/redis";
import { betaConfig, type BetaConfig } from "../config";
import type { BetaDb } from "./invites";

/**
 * Production wiring for the private-beta gate. Access lives in Postgres only: there is no
 * in-memory fallback, so without a database every gated request fails CLOSED (503
 * BETA_ACCESS_UNAVAILABLE). Redemption nonces are the M5 single-use Redis challenges (in process
 * memory only for a local-fork E2E run, like the terms challenges).
 */
export type BetaDeps = {
  config(): BetaConfig;
  db(): BetaDb;
  challenges(): ChallengeStore;
  now(): Date;
};

const defaults: BetaDeps = {
  config: () => betaConfig(process.env),
  db: () => getDb() as unknown as BetaDb,
  challenges: () =>
    localStores()
      ? memoryChallengeStore()
      : redisChallengeStore(requireRedis()),
  now: () => new Date(),
};

let overrides: Partial<BetaDeps> = {};

export function betaDeps(): BetaDeps {
  return { ...defaults, ...overrides };
}

export function setBetaDepsForTests(next: Partial<BetaDeps>): void {
  overrides = next;
}
