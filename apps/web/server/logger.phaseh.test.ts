import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, REDACTED } from "./logger";
import { publicHealth } from "./health-public";

/**
 * Phase H Step 4: JSON to stdout only, and never the origin secret, auth headers, cookies, client
 * IPs or contact details; and the public health body carries statuses only.
 */
function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: createLogger({ level: "debug", destination }) };
}

const ORIGIN = "edge-origin-secret-0123456789abcdefABCDEF";

describe("logs never carry secrets, client IPs or contact details", () => {
  it("redacts the origin header, auth, cookies and IP headers in a logged request", () => {
    const { lines, logger } = capture();
    logger.warn(
      {
        headers: {
          "x-aroma-origin": ORIGIN,
          authorization: "Bearer tok-abc",
          cookie: "aroma_session=xyz",
          "cf-connecting-ip": "203.0.113.50",
          "x-forwarded-for": "203.0.113.51",
          "x-real-ip": "203.0.113.52",
          "true-client-ip": "203.0.113.53",
          "user-agent": "visible-agent",
        },
        clientIp: "203.0.113.54",
      },
      "request",
    );
    const text = lines.join("");
    for (const hidden of [
      ORIGIN,
      "tok-abc",
      "aroma_session=xyz",
      "203.0.113.5",
    ])
      expect(text).not.toContain(hidden);
    expect(text).toContain("visible-agent");
    expect(text).toContain(REDACTED);
  });

  it("redacts contact details and push subscriptions under any nesting", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        channel: "telegram",
        chatId: "987654321",
        nested: { email: "owner@example.test", phone: "+15550100" },
        subscription: {
          endpoint: "https://push.example.test/abc",
          keys: { p256dh: "BPKEY", auth: "AUTHKEY" },
        },
      },
      "notify",
    );
    const text = lines.join("");
    for (const hidden of [
      "987654321",
      "owner@example.test",
      "+15550100",
      "push.example.test",
      "BPKEY",
      "AUTHKEY",
    ])
      expect(text).not.toContain(hidden);
    expect(text).toContain("telegram");
  });

  it("writes one JSON object per line (stdout, no files)", () => {
    const { lines, logger } = capture();
    logger.info({ a: 1 }, "x");
    logger.error({ b: 2 }, "y");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});

describe("public health body (server/health-public.ts)", () => {
  it("keeps statuses and the RPC failover facts, drops every number and key flag", () => {
    const body = publicHealth({
      status: "degraded",
      timestamp: "2026-11-15T00:00:00.000Z",
      checks: {
        rpc: {
          status: "ok",
          latencyMs: 812,
          slot: 469796128,
          lagSeconds: 2,
          primary: "ok",
          fallback: "degraded",
          fallbackInUse: false,
        },
        redis: { status: "fail", latencyMs: 149 },
        jupiter: {
          status: "degraded",
          keyed: false,
          httpStatus: 429,
          latencyMs: 3,
        },
        pyth: { status: "skipped", keyed: false, latencyMs: 2 },
      },
    });
    expect(body).toEqual({
      status: "degraded",
      timestamp: "2026-11-15T00:00:00.000Z",
      checks: {
        rpc: {
          status: "ok",
          primary: "ok",
          fallback: "degraded",
          fallbackInUse: false,
        },
        redis: { status: "down" },
        jupiter: { status: "degraded" },
        pyth: { status: "skipped" },
      },
    });
    expect(JSON.stringify(body.checks)).not.toMatch(
      /latency|slot|lag|keyed|httpStatus|\d{3,}/,
    );
  });
});

describe("Sentry naming (Phase H Step 4)", () => {
  it("environment from server/platform.ts, release from the image commit", async () => {
    const { buildSentryOptions, releaseOf } =
      await import("@/observability/sentry-options");
    expect(releaseOf({ AROMA_REVISION: "abc123" })).toEqual({
      release: "aroma-web@abc123",
    });
    expect(releaseOf({ AROMA_REVISION: "unknown" })).toEqual({});
    expect(releaseOf({ SENTRY_RELEASE: "r1", AROMA_REVISION: "abc" })).toEqual({
      release: "r1",
    });
    expect(
      buildSentryOptions("https://k@o1.ingest.sentry.io/1", "beta")
        ?.environment,
    ).toBe("beta");
  });
});
