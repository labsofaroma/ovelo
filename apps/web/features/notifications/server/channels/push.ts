import { z } from "zod";
import { pushSubscriptionSchema } from "../../schema";
import {
  type Fetch,
  type NotificationChannel,
  networkFailure,
  outcomeOf,
} from "./types";
import {
  allowedPushEndpoint,
  encryptPayload,
  vapidAuthorization,
} from "./webpush";

const addressSchema = z.object({ subscription: pushSubscriptionSchema });

/**
 * Web push channel. The payload is encrypted for the browser (RFC 8291), so the push service
 * sees only ciphertext; `tag` is the event id, so a repeated delivery replaces the earlier one
 * in the notification tray (receiver-side dedupe).
 */
export function pushChannel(
  keys: { publicKey: string; privateKey: string; subject: string },
  fetcher: Fetch = fetch,
): NotificationChannel {
  return {
    channel: "push",
    async send(delivery) {
      const parsed = addressSchema.safeParse(delivery.address);
      if (
        !parsed.success ||
        !allowedPushEndpoint(parsed.data.subscription.endpoint)
      )
        return { ok: false, retry: false, gone: true, code: "bad_address" };
      const { endpoint, keys: ua } = parsed.data.subscription;
      const body = encryptPayload({
        plaintext: Buffer.from(
          JSON.stringify({ ...delivery.message, tag: delivery.eventId }),
        ),
        p256dh: ua.p256dh,
        auth: ua.auth,
      });
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Authorization: vapidAuthorization({ endpoint, ...keys }),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Urgency: "normal",
          },
          body: new Uint8Array(body),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        return outcomeOf(response.status);
      } catch {
        return networkFailure;
      }
    },
  };
}
