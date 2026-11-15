import { pushSubscriptionSchema, type PushSubscriptionJson } from "./schema";

/**
 * Browser side of web push: register the service worker (`/notify-sw.js`, static, same origin)
 * and ask the browser for a subscription under the deployment's VAPID public key. Only on an
 * explicit click; nothing here runs on page load.
 */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

export async function browserPushSubscription(
  publicKey: string,
): Promise<PushSubscriptionJson | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const registration = await navigator.serviceWorker.register("/notify-sw.js", {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  return pushSubscriptionSchema.parse(subscription.toJSON());
}

/** Turning push off also drops the browser's own subscription. */
export async function dropBrowserPush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => false);
}
