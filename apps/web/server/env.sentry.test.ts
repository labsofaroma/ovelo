import { describe, expect, it } from "vitest";
import { BASE_ENV } from "@/server/test/base-env";
import { connectSources } from "./csp";
import { parseEnv } from "./env.schema";
import { isSentryDsn } from "./env.sentry";

const KEY = "0123456789abcdef0123456789abcdef";

describe("sentryDsn (W4)", () => {
  it.each([
    `https://${KEY}@o1.ingest.sentry.io/1`,
    `https://${KEY}@o4507001234567890.ingest.sentry.io/4507001234567891`,
    `https://${KEY}@o123.ingest.us.sentry.io/456`,
    `https://${KEY}@o123.ingest.de.sentry.io/456`,
  ])("accepts a real-shaped DSN %#", (dsn) => {
    expect(isSentryDsn(dsn)).toBe(true);
    for (const name of ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"]) {
      expect(parseEnv({ ...BASE_ENV, [name]: dsn }).ok).toBe(true);
    }
  });

  it.each([
    ["no public key", "https://o1.ingest.sentry.io/1"],
    ["http", `http://${KEY}@o1.ingest.sentry.io/1`],
    [
      "a password (legacy secret DSN)",
      `https://${KEY}:secret@o1.ingest.sentry.io/1`,
    ],
    ["an empty password", `https://${KEY}:@o1.ingest.sentry.io/1`],
    ["two userinfo parts", `https://${KEY}@${KEY}@o1.ingest.sentry.io/1`],
    ["a short key", "https://abc123@o1.ingest.sentry.io/1"],
    ["an uppercase key", `https://${KEY.toUpperCase()}@o1.ingest.sentry.io/1`],
    ["a legacy host", `https://${KEY}@sentry.io/1`],
    ["a lookalike host", `https://${KEY}@o1.ingest.sentry.io.evil.com/1`],
    ["another domain", `https://${KEY}@o1.ingest.evil.io/1`],
    ["a self-hosted host", `https://${KEY}@sentry.example.org/1`],
    ["no org prefix", `https://${KEY}@ingest.sentry.io/1`],
    ["a nested region", `https://${KEY}@o1.ingest.a.b.sentry.io/1`],
    ["a port", `https://${KEY}@o1.ingest.sentry.io:8443/1`],
    ["a non-numeric project", `https://${KEY}@o1.ingest.sentry.io/abc`],
    ["no project", `https://${KEY}@o1.ingest.sentry.io/`],
    ["a nested path", `https://${KEY}@o1.ingest.sentry.io/api/1`],
    ["a query", `https://${KEY}@o1.ingest.sentry.io/1?x=1`],
    ["an empty query", `https://${KEY}@o1.ingest.sentry.io/1?`],
    ["a fragment", `https://${KEY}@o1.ingest.sentry.io/1#x`],
    ["inner whitespace", `https://${KEY}@o1.ingest.sentry.io/ 1`],
    ["not a URL", "not-a-dsn"],
  ])("refuses %s", (_label, dsn) => {
    expect(isSentryDsn(dsn)).toBe(false);
    const result = parseEnv({ ...BASE_ENV, SENTRY_DSN: dsn });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0]?.variable).toBe("SENTRY_DSN");
      // Never echo the value (it could be a secret-bearing legacy DSN).
      expect(result.error.message).not.toContain(dsn);
      expect(result.error.message).not.toContain("secret@");
    }
  });

  it("CSP connect-src gets the ingest origin only, never the public key", () => {
    const dsn = `https://${KEY}@o123.ingest.us.sentry.io/456`;
    const sources = connectSources({ NEXT_PUBLIC_SENTRY_DSN: dsn });
    expect(sources).toContain("https://o123.ingest.us.sentry.io");
    expect(sources.join(" ")).not.toContain(KEY);
  });
});
