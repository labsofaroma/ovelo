import "server-only";
import { tryGetEnv } from "@/server/env";
import { testSwitchesAllowed } from "@/server/env.schema";

/**
 * Which notification channels this deployment can deliver, from the validated environment
 * (server/env.notify.ts: each channel is all-or-nothing). Never exposes a secret: the client
 * gets the VAPID public key and the bot's username only.
 */
export type NotifyConfig = {
  enabled: boolean;
  workerSecret: string | null;
  push: { publicKey: string; privateKey: string; subject: string } | null;
  telegram: { token: string; bot: string; webhookSecret: string } | null;
  /** E2E only: every channel delivers to this loopback sink instead. */
  sinkUrl: string | null;
};

export function notifyConfig(
  source: Record<string, string | undefined> = process.env,
): NotifyConfig {
  const result = tryGetEnv();
  if (!result.ok)
    return {
      enabled: false,
      workerSecret: null,
      push: null,
      telegram: null,
      sinkUrl: null,
    };
  const s = result.env.server;
  return {
    enabled: s.AROMA_NOTIFICATIONS === "on",
    workerSecret: s.AROMA_NOTIFY_WORKER_SECRET ?? null,
    push:
      s.VAPID_PUBLIC_KEY && s.VAPID_PRIVATE_KEY && s.VAPID_SUBJECT
        ? {
            publicKey: s.VAPID_PUBLIC_KEY,
            privateKey: s.VAPID_PRIVATE_KEY,
            subject: s.VAPID_SUBJECT,
          }
        : null,
    telegram:
      s.TELEGRAM_BOT_TOKEN &&
      s.TELEGRAM_BOT_USERNAME &&
      s.TELEGRAM_WEBHOOK_SECRET
        ? {
            token: s.TELEGRAM_BOT_TOKEN,
            bot: s.TELEGRAM_BOT_USERNAME,
            webhookSecret: s.TELEGRAM_WEBHOOK_SECRET,
          }
        : null,
    sinkUrl:
      s.AROMA_V1_TEST_NOTIFY_SINK_URL && testSwitchesAllowed(source)
        ? s.AROMA_V1_TEST_NOTIFY_SINK_URL
        : null,
  };
}

/** What the browser may know: whether it is on, the VAPID public key, the bot's username. */
export function publicNotifyConfig(config: NotifyConfig) {
  return {
    enabled: config.enabled,
    push: config.push ? { publicKey: config.push.publicKey } : null,
    telegram: config.telegram ? { bot: config.telegram.bot } : null,
  };
}
