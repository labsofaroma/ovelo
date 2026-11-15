import type { BetaChannel } from "../../schema";
import type { Delivery, DeliveryResult, NotificationChannel } from "./types";

/**
 * Local fakes. `memoryChannel` records deliveries in process (unit and property tests);
 * `sinkChannel` posts them to a loopback test sink (E2E only: test switches and a loopback URL,
 * see server/env.notify.ts). Neither can reach a real provider.
 */
export function memoryChannel(
  channel: BetaChannel,
  behave: (delivery: Delivery, attempt: number) => DeliveryResult = () => ({
    ok: true,
  }),
): NotificationChannel & { sent: Delivery[]; attempts: Map<string, number> } {
  const sent: Delivery[] = [];
  const attempts = new Map<string, number>();
  return {
    channel,
    sent,
    attempts,
    async send(delivery) {
      const n = (attempts.get(delivery.eventId) ?? 0) + 1;
      attempts.set(delivery.eventId, n);
      const result = behave(delivery, n);
      if (result.ok) sent.push(delivery);
      return result;
    },
  };
}

export function sinkChannel(
  channel: BetaChannel,
  url: string,
): NotificationChannel {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url))
    throw new Error("the notification sink must be a loopback URL");
  return {
    channel,
    async send(delivery) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            eventId: delivery.eventId,
            message: delivery.message,
          }),
        });
        return response.ok
          ? { ok: true }
          : {
              ok: false,
              retry: true,
              gone: false,
              code: `http_${response.status}`,
            };
      } catch {
        return { ok: false, retry: true, gone: false, code: "network" };
      }
    },
  };
}
