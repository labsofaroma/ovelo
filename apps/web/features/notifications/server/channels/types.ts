import type { BetaChannel } from "../../schema";

/** A rendered notification: facts only (PRODUCT.md), plain text, one link. */
export type NotifyMessage = {
  title: string;
  body: string;
  /** An explorer link or an Ovelo page (absolute https URL). */
  url: string;
};

export type Delivery = {
  /** Deterministic event id: the receiver dedupes on it (push `tag`). */
  eventId: string;
  channel: BetaChannel;
  message: NotifyMessage;
  /** The verified contact detail from `notification_subscriptions.address`. Never logged. */
  address: Record<string, unknown>;
};

export type DeliveryResult =
  | { ok: true }
  /** `gone`: the subscription no longer exists at the provider; it is deleted. */
  | { ok: false; retry: boolean; gone: boolean; code: string };

/** One delivery channel. Every external service sits behind this, with a local fake. */
export type NotificationChannel = {
  channel: BetaChannel;
  send(delivery: Delivery): Promise<DeliveryResult>;
};

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** HTTP status → outcome, shared by the HTTP channels. Never reads or keeps the body. */
export function outcomeOf(status: number): DeliveryResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 404 || status === 410)
    return { ok: false, retry: false, gone: true, code: `http_${status}` };
  if (status === 429 || status >= 500)
    return { ok: false, retry: true, gone: false, code: `http_${status}` };
  return { ok: false, retry: false, gone: false, code: `http_${status}` };
}

export const networkFailure: DeliveryResult = {
  ok: false,
  retry: true,
  gone: false,
  code: "network",
};
