import "server-only";
import {
  memoryChallengeStore,
  redisChallengeStore,
} from "@/features/creators/http";
import { localStores } from "@/features/trade/server/local";
import { getDb } from "@/server/db/client";
import { localNeonProxy } from "@/server/db/local-neon";
import { requireRedis } from "@/server/redis";
import { loadPolicy } from "../policy";
import { dbTermsStore, memoryTermsStore } from "./store";
import type { TermsDeps, TermsStore } from "./terms";

/**
 * Production wiring for the compliance gate. Postgres and Redis are required; the only
 * exception is a local-fork E2E run (test switches + fork genesis, never production), which
 * uses in-process stores unless it runs the local Postgres (as the trade receipts do).
 */
let memory: TermsStore | null = null;

function store(): TermsStore {
  if (localStores() && !localNeonProxy(process.env.DATABASE_URL ?? ""))
    return (memory ??= memoryTermsStore());
  return dbTermsStore(getDb());
}

const defaults: TermsDeps = {
  store,
  challenges: () =>
    localStores()
      ? memoryChallengeStore()
      : redisChallengeStore(requireRedis()),
  policy: () => loadPolicy(process.env),
  now: () => new Date(),
};

let overrides: Partial<TermsDeps> = {};

export function complianceDeps(): TermsDeps {
  return { ...defaults, ...overrides };
}

export function setComplianceDepsForTests(next: Partial<TermsDeps>): void {
  overrides = next;
}
