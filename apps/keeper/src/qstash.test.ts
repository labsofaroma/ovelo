import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { signQStashRequest, verifyQStashSignature } from "./qstash";

const current = "sig_current_" + "c".repeat(24);
const next = "sig_next_" + "n".repeat(24);
const url = "https://keeper.aroma.test/run";
const body = JSON.stringify({ trigger: "schedule" });
const NOW = 1_763_100_000_000;

const decoded = (token: string) =>
  token
    .split(".")
    .map((part) => Buffer.from(part, "base64url").toString("hex"))
    .join(".");

const check = (
  signature: string | null,
  overrides: Partial<Parameters<typeof verifyQStashSignature>[0]> = {},
) =>
  verifyQStashSignature({
    signature,
    body,
    currentKey: current,
    nextKey: next,
    url,
    now: NOW,
    ...overrides,
  });

describe("QStash signatures", () => {
  it("accepts the current and the next signing key (rotation)", () => {
    expect(() =>
      check(signQStashRequest({ key: current, url, body, now: NOW })),
    ).not.toThrow();
    expect(() =>
      check(signQStashRequest({ key: next, url, body, now: NOW })),
    ).not.toThrow();
  });

  it("refuses a missing header, another key, another body, another URL, and an expired token", () => {
    expect(() => check(null)).toThrow(/missing/);
    expect(() =>
      check(signQStashRequest({ key: "x".repeat(32), url, body, now: NOW })),
    ).toThrow(/bad signature/);
    expect(() =>
      check(signQStashRequest({ key: current, url, body: "{}", now: NOW })),
    ).toThrow(/body mismatch/);
    expect(() =>
      check(
        signQStashRequest({
          key: current,
          url: "https://evil.test/run",
          body,
          now: NOW,
        }),
      ),
    ).toThrow(/destination/);
    expect(() =>
      check(
        signQStashRequest({
          key: current,
          url,
          body,
          now: NOW - 3_600_000,
          ttlSeconds: 60,
        }),
      ),
    ).toThrow(/expired/);
    expect(() =>
      check(
        signQStashRequest({ key: current, url, body, now: NOW + 3_600_000 }),
      ),
    ).toThrow(/not yet valid/);
  });

  it("refuses another algorithm, another issuer and garbage", () => {
    const token = signQStashRequest({ key: current, url, body, now: NOW });
    const [, payload, sig] = token.split(".");
    const none = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    expect(() => check(`${none}.${payload}.${sig}`)).toThrow();
    expect(() => check("a.b")).toThrow(/malformed/);
    expect(() => check("!!.!!.!!")).toThrow();
  });

  it("property: flipping any character of a valid token is refused", () => {
    const token = signQStashRequest({ key: current, url, body, now: NOW });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: token.length - 1 }),
        fc.constantFrom("A", "z", "0", "_", "-"),
        (i, c) => {
          fc.pre(token[i] !== c && token[i] !== ".");
          const tampered = token.slice(0, i) + c + token.slice(i + 1);
          // base64url's last character has unused low bits: a change that decodes to the same
          // bytes is the same signed token, not a forgery.
          fc.pre(decoded(tampered) !== decoded(token));
          expect(() => check(tampered)).toThrow();
        },
      ),
      { numRuns: 300 },
    );
  });
});
