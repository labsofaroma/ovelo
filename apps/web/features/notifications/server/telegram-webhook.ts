import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { botCopy } from "../copy";
import { telegramSend } from "./channels/telegram";
import type { NotifyDeps } from "./deps";
import { stopTelegramChat, verifyTelegram } from "./subscriptions";

/**
 * Telegram webhook (setWebhook with `secret_token`). Telegram sends that secret in
 * `X-Telegram-Bot-Api-Secret-Token`, so this state-changing route is authenticated by a bearer
 * secret (AGENTS.md rule 2). Only private chats count; only `/start <code>` and `/stop` change
 * anything. The chat id is stored once the one-time code matches; it is never logged.
 */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      chat: z.object({ id: z.number().int(), type: z.string() }),
      text: z.string().max(4_096).optional(),
    })
    .optional(),
});

export function assertTelegramSecret(
  deps: NotifyDeps,
  header: string | null,
): void {
  const expected = deps.config().telegram?.webhookSecret;
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(expected ?? "");
  if (
    !expected ||
    given.length !== want.length ||
    !timingSafeEqual(given, want)
  )
    throw new AppError("UNAUTHORIZED", { detail: "telegram webhook secret" });
}

export type BotReply = (chatId: number, text: string) => Promise<unknown>;

export function defaultReply(deps: NotifyDeps): BotReply {
  const config = deps.config();
  if (config.sinkUrl) {
    const sink = config.sinkUrl;
    return (chatId, text) =>
      fetch(sink, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "telegram-reply", chatId, text }),
      }).catch(() => null);
  }
  const token = config.telegram?.token;
  return token
    ? (chatId, text) => telegramSend(token, chatId, text)
    : async () => null;
}

export async function handleTelegramUpdate(
  deps: NotifyDeps,
  body: unknown,
  reply: BotReply = defaultReply(deps),
): Promise<{ ok: true }> {
  const parsed = updateSchema.safeParse(body);
  const message = parsed.success ? parsed.data.message : undefined;
  if (!message || message.chat.type !== "private" || !message.text)
    return { ok: true };
  const [command, argument] = message.text.trim().split(/\s+/, 2);
  const chatId = message.chat.id;
  if (command === "/start" && argument) {
    const linked = deps.config().enabled
      ? await verifyTelegram(deps.db(), {
          code: argument,
          chatId,
          now: deps.now(),
        })
      : false;
    await reply(chatId, linked ? botCopy.linked : botCopy.badCode);
  } else if (command === "/stop") {
    await stopTelegramChat(deps.db(), chatId);
    await reply(chatId, botCopy.stopped);
  } else await reply(chatId, botCopy.help);
  return { ok: true };
}
