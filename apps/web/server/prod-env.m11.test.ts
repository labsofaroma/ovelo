import { describe, expect, it } from "vitest";
import { generateVapidKeys } from "@/features/notifications/server/channels/webpush";
import { staticFindings } from "./prod-env";
import { m11Findings } from "./prod-env.m11";

const vapid = generateVapidKeys();
const PUSH = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:ops@aroma.test",
};
const of = (findings: { name: string; status: string }[], name: string) =>
  findings.filter((f) => f.name === name).map((f) => f.status);

describe("M11 production checks", () => {
  it("a complete channel is ok; an absent one warns (optional); the worker secret is recommended", () => {
    const findings = m11Findings(PUSH);
    expect(of(findings, "VAPID_PUBLIC_KEY")).toEqual(["ok"]);
    expect(of(findings, "TELEGRAM_BOT_TOKEN")).toEqual(["warning"]);
    expect(of(findings, "AROMA_NOTIFY_WORKER_SECRET")).toEqual(["warning"]);
  });

  it("the shared profile refuses a half-set channel, a channel without the worker secret, a fee and the sink", () => {
    const findings = staticFindings({
      VAPID_PUBLIC_KEY: vapid.publicKey,
      TELEGRAM_BOT_TOKEN: `123456:${"A".repeat(35)}`,
      TELEGRAM_BOT_USERNAME: "aroma_bot",
      TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
      AROMA_PLATFORM_FEE_BPS: "30",
      AROMA_V1_TEST_NOTIFY_SINK_URL: "http://127.0.0.1:4040/sink",
    });
    expect(of(findings, "VAPID_PRIVATE_KEY")).toContain("invalid");
    expect(of(findings, "AROMA_NOTIFY_WORKER_SECRET")).toContain("invalid");
    expect(of(findings, "AROMA_PLATFORM_FEE_BPS")).toContain("invalid");
    expect(of(findings, "AROMA_V1_TEST_NOTIFY_SINK_URL")).toContain(
      "forbidden",
    );
  });

  it("analytics: a domain that is not the site's host can never send, so it warns", () => {
    expect(
      of(
        m11Findings({
          AROMA_SITE_URL: "https://beta.aroma.app",
          NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "aroma.app",
        }),
        "NEXT_PUBLIC_PLAUSIBLE_DOMAIN",
      ),
    ).toEqual(["warning"]);
    expect(
      of(
        m11Findings({
          AROMA_SITE_URL: "https://beta.aroma.app",
          NEXT_PUBLIC_PLAUSIBLE_DOMAIN: "beta.aroma.app",
        }),
        "NEXT_PUBLIC_PLAUSIBLE_DOMAIN",
      ),
    ).toEqual(["ok"]);
  });

  it("the pause switch warns; a placeholder Telegram value is caught like any app variable", () => {
    expect(
      of(m11Findings({ AROMA_NOTIFICATIONS: "off" }), "AROMA_NOTIFICATIONS"),
    ).toEqual(["warning"]);
    expect(
      of(
        staticFindings({ TELEGRAM_BOT_USERNAME: "placeholder_bot" }),
        "TELEGRAM_BOT_USERNAME",
      ),
    ).toContain("forbidden");
  });
});
