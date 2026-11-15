import "server-only";
import { getMarkets } from "@/features/markets/server";
import {
  memoryChallengeStore,
  redisChallengeStore,
} from "@/features/creators/http";
import { localStores } from "@/features/trade/server/local";
import type { ChallengeStore } from "@/server/auth/creator";
import { getDb } from "@/server/db/client";
import { requireRedis } from "@/server/redis";
import type { BetaChannel } from "../schema";
import { sinkChannel } from "./channels/fakes";
import { pushChannel } from "./channels/push";
import { telegramChannel } from "./channels/telegram";
import type { NotificationChannel } from "./channels/types";
import { notifyConfig, type NotifyConfig } from "./config";
import type { NotifyDb } from "./outbox";
import type { WorkerDeps } from "./worker";

/** Production wiring for notifications; route tests swap in PGlite, memory nonces and fakes. */
export type NotifyDeps = WorkerDeps & {
  config(): NotifyConfig;
  challenges(): ChallengeStore;
};

export function channelsFor(
  config: NotifyConfig,
): Partial<Record<BetaChannel, NotificationChannel>> {
  if (config.sinkUrl)
    return {
      push: sinkChannel("push", config.sinkUrl),
      telegram: sinkChannel("telegram", config.sinkUrl),
    };
  return {
    ...(config.push ? { push: pushChannel(config.push) } : {}),
    ...(config.telegram
      ? { telegram: telegramChannel(config.telegram.token) }
      : {}),
  };
}

const defaults: NotifyDeps = {
  config: () => notifyConfig(),
  db: () => getDb() as unknown as NotifyDb,
  challenges: () =>
    localStores()
      ? memoryChallengeStore()
      : redisChallengeStore(requireRedis()),
  channels: () => channelsFor(notifyConfig()),
  async scan() {
    const markets = await getMarkets().catch(() => null);
    const rows = markets?.state === "ok" ? markets.data.rows : [];
    const baskets = markets?.state === "ok" ? markets.data.baskets : [];
    const symbols = new Map(rows.map((r) => [r.mint, r.symbol]));
    const names = new Map(baskets.map((b) => [b.id, b.name]));
    return {
      symbolOf: (mint) => symbols.get(mint) ?? null,
      basketNameOf: (ref) => names.get(ref) ?? null,
    };
  },
  site: () =>
    (process.env.AROMA_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  now: () => new Date(),
};

let overrides: Partial<NotifyDeps> = {};
export function notifyDeps(): NotifyDeps {
  return { ...defaults, ...overrides };
}
export function setNotifyDepsForTests(next: Partial<NotifyDeps>): void {
  overrides = next;
}
