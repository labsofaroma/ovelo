/**
 * Consent-gated analytics (the ConsentBanner choice). An event is sent only when the visitor
 * opted in, the deployment configures a Plausible domain served from this host, and no
 * Do-Not-Track / Global Privacy Control signal is set. Events carry a name and a few fixed,
 * coarse properties: never a wallet address, amount, signature, search or referrer.
 */
export const CONSENT_KEY = "ovelo.privacy.v1";
const DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "";

export function readConsent(): boolean | null {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(CONSENT_KEY) ?? "null",
    );
    if (
      saved &&
      typeof saved === "object" &&
      "analytics" in saved &&
      typeof saved.analytics === "boolean" &&
      "expiresAt" in saved &&
      typeof saved.expiresAt === "number" &&
      saved.expiresAt > Date.now()
    )
      return saved.analytics;
  } catch {
    /* blocked storage: no consent */
  }
  return null;
}

export function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const signal =
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true;
  return (
    readConsent() === true &&
    Boolean(DOMAIN) &&
    DOMAIN === location.hostname &&
    !signal
  );
}

export type EventProps = Record<string, string>;

/** Send one event (no-op without consent). `path` is a route category, never a full URL. */
export function trackEvent(
  name: string,
  path: string,
  props: EventProps = {},
): boolean {
  if (!analyticsAllowed()) return false;
  void fetch("https://plausible.io/api/event", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    keepalive: true,
    body: JSON.stringify({
      name,
      domain: DOMAIN,
      url: `https://${DOMAIN}${path}`,
      props,
    }),
  }).catch(() => {});
  return true;
}
