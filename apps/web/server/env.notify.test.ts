import { describe, expect, it, vi } from "vitest";
import { generateVapidKeys } from "@/features/notifications/server/channels/webpush";
import { parseEnv } from "./env.schema";
import { BASE_ENV } from "./test/base-env";

vi.mock("@/features/compliance/terms", async (orig) =>
  (await import("@/server/test/final-terms")).withFinalTerms(await orig()),
);

const vapid = generateVapidKeys();
const PUSH = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:ops@aroma.example",
};
const TELEGRAM = {
  TELEGRAM_BOT_TOKEN: `123456:${"A".repeat(35)}`,
  TELEGRAM_BOT_USERNAME: "aroma_alerts_bot",
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
};
const problems = (env: Record<string, string>) => {
  const result = parseEnv({ ...BASE_ENV, ...env });
  return result.ok ? [] : result.error.issues.map((i) => i.variable);
};

describe("M11 notification variables", () => {
  it("no channel at all is valid (notifications simply have nowhere to go)", () => {
    expect(problems({})).toEqual([]);
  });

  it("a complete channel is valid; a half-set channel is refused, naming what is missing", () => {
    expect(problems({ ...PUSH, ...TELEGRAM })).toEqual([]);
    expect(problems({ VAPID_PUBLIC_KEY: vapid.publicKey })).toEqual([
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ]);
    expect(
      problems({ TELEGRAM_BOT_TOKEN: TELEGRAM.TELEGRAM_BOT_TOKEN }),
    ).toEqual(["TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"]);
  });

  it("malformed keys are refused", () => {
    expect(problems({ ...PUSH, VAPID_PUBLIC_KEY: "short" })).toContain(
      "VAPID_PUBLIC_KEY",
    );
    expect(problems({ ...TELEGRAM, TELEGRAM_BOT_TOKEN: "nope" })).toContain(
      "TELEGRAM_BOT_TOKEN",
    );
    expect(
      problems({ ...TELEGRAM, TELEGRAM_WEBHOOK_SECRET: "short" }),
    ).toContain("TELEGRAM_WEBHOOK_SECRET");
  });

  it("production with a channel needs the worker secret; the E2E sink is refused there", () => {
    const prod = {
      VERCEL_ENV: "production",
      AROMA_MAX_TRADE_USDC_RAW: "1",
      AROMA_MAX_DAILY_USDC_RAW: "1",
    };
    expect(problems({ ...prod, ...TELEGRAM })).toEqual([
      "AROMA_NOTIFY_WORKER_SECRET",
    ]);
    expect(
      problems({
        ...prod,
        ...TELEGRAM,
        AROMA_NOTIFY_WORKER_SECRET: "x".repeat(32),
      }),
    ).toEqual([]);
    expect(
      problems({
        ...prod,
        AROMA_V1_TEST_NOTIFY_SINK_URL: "http://127.0.0.1:4040/sink",
      }),
    ).toEqual(["AROMA_V1_TEST_NOTIFY_SINK_URL"]);
  });

  it("the pause switch accepts on or off only", () => {
    expect(problems({ AROMA_NOTIFICATIONS: "off" })).toEqual([]);
    expect(problems({ AROMA_NOTIFICATIONS: "paused" })).toEqual([
      "AROMA_NOTIFICATIONS",
    ]);
  });
});
