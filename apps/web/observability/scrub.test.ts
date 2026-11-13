import { describe, expect, it } from "vitest";
import { buildSentryOptions } from "./sentry-options";
import { scrubSentryEvent, scrubTelemetryText, scrubUrl } from "./scrub";

const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const SIGNATURE = "5".repeat(88);

describe("scrubTelemetryText", () => {
  it("replaces wallet addresses but not longer tokens such as signatures", () => {
    expect(scrubTelemetryText(`owner ${WALLET} failed`)).toBe(
      "owner [wallet] failed",
    );
    expect(scrubTelemetryText(SIGNATURE)).toBe(SIGNATURE);
  });

  it("scrubs secrets too", () => {
    expect(scrubTelemetryText("Bearer abc.def password=hunter2")).not.toMatch(
      /abc\.def|hunter2/,
    );
  });
});

describe("scrubUrl", () => {
  it("drops the query string and wallet path segments", () => {
    expect(
      scrubUrl(
        `https://aroma.example/api/v1/portfolio/${WALLET}?wallet=${WALLET}&x=1`,
      ),
    ).toBe("https://aroma.example/api/v1/portfolio/[wallet]");
  });
});

describe("scrubSentryEvent", () => {
  const event = {
    event_id: "1",
    message: `swap failed for ${WALLET}`,
    transaction: `GET /api/v1/portfolio/${WALLET}`,
    user: { id: WALLET, ip_address: "203.0.113.9", email: "a@b.co" },
    server_name: "host-1",
    request: {
      url: `https://aroma.example/api/v1/portfolio/${WALLET}?token=abc`,
      method: "GET",
      query_string: `wallet=${WALLET}`,
      cookies: { session: "s" },
      headers: {
        authorization: "Bearer xyz",
        "x-forwarded-for": "203.0.113.9",
      },
      data: { wallet: WALLET },
    },
    exception: {
      values: [{ type: "Error", value: `account ${WALLET} not found` }],
    },
    breadcrumbs: [
      {
        message: `fetch ${WALLET}`,
        data: {
          url: `https://rpc.example/?api-key=SECRET&owner=${WALLET}`,
          authorization: "Bearer q",
        },
      },
    ],
    tags: { wallet: WALLET, route: "/portfolio" },
    extra: { signer: WALLET, keypair: Array.from({ length: 64 }, (_, i) => i) },
  };

  it("removes user, IP, cookies, headers, bodies and query strings", () => {
    const out = scrubSentryEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.request?.cookies).toBeUndefined();
    expect(out.request?.headers).toBeUndefined();
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
  });

  it("leaves no wallet address or secret anywhere in the serialised event", () => {
    const text = JSON.stringify(scrubSentryEvent(event));
    expect(text).not.toContain(WALLET);
    expect(text).not.toMatch(
      /203\.0\.113\.9|a@b\.co|Bearer|SECRET|hunter|"keypair":\[/,
    );
    expect(text).toContain("[wallet]");
  });

  it("does not mutate its input", () => {
    scrubSentryEvent(event);
    expect(event.user.id).toBe(WALLET);
  });
});

describe("buildSentryOptions", () => {
  it("is null (a complete no-op) when the DSN is absent or blank", () => {
    expect(buildSentryOptions(undefined, undefined)).toBeNull();
    expect(buildSentryOptions("   ", "production")).toBeNull();
  });

  it("never sends default PII and scrubs in beforeSend", () => {
    const options = buildSentryOptions(
      "https://key@o1.ingest.sentry.io/1",
      "preview",
    );
    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.environment).toBe("preview");
    const out = options?.beforeSend({
      user: { ip_address: "1.1.1.1" },
      message: WALLET,
    });
    expect(out?.user).toBeUndefined();
    expect(out?.message).toBe("[wallet]");
  });
});
