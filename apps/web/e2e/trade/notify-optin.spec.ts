import { expect, test } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";
import { NOTIFY_SINK_URL } from "../fork/notify-sink";
import { signMessageBase64 } from "./wallet";

/**
 * M11 Step 1 (fork E2E, part 1, before the purchase specs): the test wallet opts Telegram in
 * with a signed challenge, and the "bot" (the webhook, with its secret) receives the one-time
 * code. Every channel delivers to the loopback sink (e2e/fork/notify-sink.ts).
 */
const wallet = e2eWallet().publicKey.toBase58();
const events = ["trade_confirmed", "trade_failed", "trade_unconfirmed"];
const sign = (message: string) =>
  signMessageBase64(Buffer.from(message, "utf8").toString("base64"));

test("opt in to Telegram notifications and verify the chat", async ({
  request,
}) => {
  const challenge = await request.post("/api/v1/notifications/challenge", {
    data: { purpose: "notify-subscribe", wallet, channel: "telegram", events },
  });
  expect(challenge.status()).toBe(200);
  const { nonce, message } = await challenge.json();
  expect(message).toContain("does not move funds");
  const opted = await request.post("/api/v1/notifications/subscriptions", {
    data: {
      wallet,
      nonce,
      signature: sign(message),
      channel: "telegram",
      events,
    },
  });
  expect(opted.status()).toBe(200);
  const { telegramLink, subscription } = await opted.json();
  expect(subscription.status).toBe("pending");
  const code = new URL(telegramLink).searchParams.get("start");

  const webhook = (secret: string) =>
    request.post("/api/v1/notifications/telegram", {
      headers: { "x-telegram-bot-api-secret-token": secret },
      data: {
        update_id: 1,
        message: {
          chat: { id: 4242, type: "private" },
          text: `/start ${code}`,
        },
      },
    });
  expect(
    (await webhook("wrong-secret-wrong-secret-wrong-secret")).status(),
  ).toBe(401);
  expect((await webhook(process.env.TELEGRAM_WEBHOOK_SECRET!)).status()).toBe(
    200,
  );
  const sink = await (await request.get(NOTIFY_SINK_URL)).json();
  expect(sink).toContainEqual(
    expect.objectContaining({
      channel: "telegram-reply",
      chatId: 4242,
      text: expect.stringMatching(/^Linked\./),
    }),
  );
});
