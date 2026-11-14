import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
vi.mock("@sentry/nextjs", () => ({ init, captureRequestError: vi.fn() }));

const { initSentry } = await import("./sentry-init");

/** W4: a real-shaped DSN now passes the boot schema; init must still be DSN-gated and scrubbed. */
const DSN = `https://${"0f".repeat(16)}@o123.ingest.us.sentry.io/456`;
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("initSentry", () => {
  beforeEach(() => init.mockClear());

  it("does nothing without a DSN", () => {
    expect(initSentry(undefined)).toBe(false);
    expect(initSentry("  ")).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("initialises with a real-shaped DSN, no default PII and scrubbing hooks", () => {
    expect(initSentry(DSN, "beta")).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]![0] as {
      dsn: string;
      environment: string;
      sendDefaultPii: boolean;
      beforeSend: (e: object) => {
        user?: unknown;
        message?: string;
        request?: { headers?: unknown };
      } | null;
    };
    expect(options.dsn).toBe(DSN);
    expect(options.environment).toBe("beta");
    expect(options.sendDefaultPii).toBe(false);
    const out = options.beforeSend({
      user: { ip_address: "1.1.1.1" },
      message: `buy from ${WALLET}`,
      request: { headers: { cookie: "s=1" } },
    });
    expect(out?.user).toBeUndefined();
    expect(out?.message).not.toContain(WALLET);
    expect(JSON.stringify(out)).not.toContain("s=1");
  });
});
