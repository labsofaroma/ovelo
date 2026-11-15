import { z } from "zod";
import {
  type Fetch,
  type NotificationChannel,
  networkFailure,
  outcomeOf,
} from "./types";

const addressSchema = z.object({ chatId: z.number().int() });
const API = "https://api.telegram.org";

/** Plain-text message (no parse mode, so nothing in it is interpreted as markup). */
export function telegramText(message: {
  title: string;
  body: string;
  url: string;
}): string {
  return `${message.title}\n${message.body}\n${message.url}`;
}

/**
 * Telegram Bot API `sendMessage`, with plain `fetch` (no client library). The bot token is part
 * of the URL, so the URL is never logged; 403 means the user blocked the bot (gone).
 */
export function telegramChannel(
  token: string,
  fetcher: Fetch = fetch,
): NotificationChannel {
  return {
    channel: "telegram",
    async send(delivery) {
      const parsed = addressSchema.safeParse(delivery.address);
      if (!parsed.success)
        return { ok: false, retry: false, gone: true, code: "bad_address" };
      return telegramSend(
        token,
        parsed.data.chatId,
        telegramText(delivery.message),
        fetcher,
      );
    },
  };
}

export async function telegramSend(
  token: string,
  chatId: number,
  text: string,
  fetcher: Fetch = fetch,
) {
  try {
    const response = await fetcher(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403)
      return { ok: false as const, retry: false, gone: true, code: "http_403" };
    return outcomeOf(response.status);
  } catch {
    return networkFailure;
  }
}
