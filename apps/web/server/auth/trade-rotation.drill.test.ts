import { stubBaseEnv } from "@/server/test/base-env";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../env.schema";
import { resetEnvCacheForTests } from "../env";
import {
  keyId,
  keyringFromEnv,
  openAuthorization,
  sealAuthorization,
  type TradePayload,
} from "./trade";

// M9: no feature flag, so every environment needs the required variables.
beforeEach(() => stubBaseEnv());

/**
 * P4 trade-secret rotation drill (docs/launch/KEY-CUSTODY.md §3, M4-DEPLOY.md §2), through the
 * real env path (`keyringFromEnv`): issue with the old key → rotate (new key, old one in
 * AROMA_TRADE_SECRET_PREVIOUS) → old tokens verify until they expire, new tokens use the new key
 * id → remove the previous key → old tokens are refused.
 */
const OLD = randomBytes(32).toString("base64url");
const NEW = randomBytes(32).toString("base64url");
const NOW = 1_800_000_000_000;
const QUOTE_LIFETIME = 60_000;

const payload = (): TradePayload => ({
  kind: "trade",
  requestId: randomUUID(),
  taker: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  expiresAt: NOW + QUOTE_LIFETIME,
  lastValidBlockHeight: 1,
  transactionVersion: 0,
  messageHashes: ["a".repeat(64)],
  receipt: {
    kind: "spot",
    basketId: null,
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inAmount: "1000000",
    legs: [
      {
        mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
        inputAmount: "1000000",
        outAmount: "1",
        minimumAmount: "1",
        tx: 0,
      },
    ],
  },
});

function deploy(env: { current: string; previous?: string }) {
  vi.stubEnv("AROMA_TRADE_SECRET", env.current);
  vi.stubEnv("AROMA_TRADE_SECRET_PREVIOUS", env.previous ?? "");
  resetEnvCacheForTests();
  return keyringFromEnv();
}
const kidOf = (token: string) => token.split(".")[1];

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("AROMA_TRADE_SECRET rotation drill", () => {
  it("issue old → rotate → old verifies until expiry, new uses the new key id → drop previous → old refused", () => {
    // 1. Before the rotation: a quote authorized with the old key.
    const before = deploy({ current: OLD });
    const oldToken = sealAuthorization(payload(), before);
    expect(kidOf(oldToken)).toBe(keyId(OLD));

    // 2. Rotate: new key current, old key previous.
    const during = deploy({ current: NEW, previous: OLD });
    expect(
      openAuthorization(oldToken, during, { now: NOW + 1_000 }).requestId,
    ).toBeTruthy();
    const newToken = sealAuthorization(payload(), during);
    expect(kidOf(newToken)).toBe(keyId(NEW));
    expect(keyId(NEW)).not.toBe(keyId(OLD));
    expect(
      openAuthorization(newToken, during, { now: NOW + 1_000 }),
    ).toBeTruthy();

    // 3. The old token still obeys its own expiry under the previous key.
    expect(() =>
      openAuthorization(oldToken, during, { now: NOW + QUOTE_LIFETIME + 1 }),
    ).toThrow(expect.objectContaining({ code: "QUOTE_EXPIRED" }));

    // 4. After one quote lifetime plus the rollout: remove the previous key.
    const after = deploy({ current: NEW });
    expect(() =>
      openAuthorization(oldToken, after, { now: NOW + 1_000 }),
    ).toThrow(
      expect.objectContaining({
        code: "AUTHORIZATION_INVALID",
        detail: "unknown key id",
      }),
    );
    expect(
      openAuthorization(newToken, after, { now: NOW + 1_000 }),
    ).toBeTruthy();
  });

  it("a forged token under the old key id with the new secret is refused", () => {
    const during = deploy({ current: NEW, previous: OLD });
    const token = sealAuthorization(payload(), during);
    const [v, , body, mac] = token.split(".");
    expect(() =>
      openAuthorization(`${v}.${keyId(OLD)}.${body}.${mac}`, during, {
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "AUTHORIZATION_INVALID" }));
  });

  it("leak response: a new key with no previous makes every in-flight token fail closed", () => {
    const leaked = sealAuthorization(payload(), deploy({ current: OLD }));
    const emergency = deploy({ current: NEW });
    expect(() => openAuthorization(leaked, emergency, { now: NOW })).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_INVALID" }),
    );
  });

  it("boot refuses a previous key equal to the current one, by name only", () => {
    const result = parseEnv({
      AROMA_TRADE_SECRET: NEW,
      AROMA_TRADE_SECRET_PREVIOUS: NEW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((i) => i.variable)).toContain(
        "AROMA_TRADE_SECRET_PREVIOUS",
      );
      expect(result.error.message).not.toContain(NEW);
    }
  });
});
