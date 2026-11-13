import { address, getProgramDerivedAddress } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { makeSigner, memoryStore } from "../test/creator-fixtures";
import {
  CHALLENGE_TTL_SECONDS,
  type ChallengeStore,
  challengeMessage,
  contentHash,
  issueChallenge,
  parseSignature,
  payloadHash,
  verifyChallenge,
  walletSchema,
} from "./creator";

/**
 * Ported from apps/web/tests/creator-auth.test.ts. The prototype bound the approval with an HMAC
 * token; v1 binds it with a single-use nonce whose payload lives in Redis. The same guarantees are
 * asserted: owner, content, origin, expiry and signature, plus replay and purpose, which the
 * prototype checked in its store.
 */

const ORIGIN = "https://aroma.test";
const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const BASKET_ID = "8c1f6c0e-3b0d-4a0f-9a59-3a7a4f1d2c11";
const CONTENT = {
  name: "A basket",
  ticker: "TEST",
  allocations: [
    { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", weightBps: 5000 },
    { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", weightBps: 5000 },
  ],
};

async function detailOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return `${error.code}:${error.detail}`;
    throw error;
  }
  return "ok";
}

async function issued(purpose: "publish" | "update" | "delete" = "publish") {
  const store = memoryStore();
  const signer = await makeSigner();
  const challenge = await issueChallenge(
    store,
    {
      origin: ORIGIN,
      wallet: signer.wallet,
      purpose,
      basketId: BASKET_ID,
      content: purpose === "delete" ? null : CONTENT,
      summary: ["Basket: A basket (TEST)"],
    },
    { now: NOW },
  );
  const signature = await signer.sign(challenge.message);
  const request = {
    origin: ORIGIN,
    wallet: signer.wallet,
    purpose,
    basketId: BASKET_ID,
    content: purpose === "delete" ? null : CONTENT,
    summary: ["Basket: A basket (TEST)"],
    nonce: challenge.payload.nonce,
    signature,
  };
  return { store, signer, challenge, signature, request };
}

describe("creator challenge (ported from creator-auth.test.ts)", () => {
  it("binds owner, content, origin and expiry, and verifies the wallet signature", async () => {
    const { store, signer, challenge, request } = await issued();
    expect(challenge.payload).toMatchObject({
      v: 1,
      origin: ORIGIN,
      wallet: signer.wallet,
      purpose: "publish",
      basketId: BASKET_ID,
      contentHash: contentHash(CONTENT),
      issuedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    });
    const verified = await verifyChallenge(store, request, { now: NOW + 1 });
    expect(verified.wallet).toBe(signer.wallet);
  });

  it("shows a human-readable message that names the action, wallet, basket and expiry", async () => {
    const { challenge, signer } = await issued();
    const message = challenge.message;
    expect(message.split("\n")[0]).toBe(
      "Aroma: sign to publish a creator basket",
    );
    expect(message).toContain(`Wallet: ${signer.wallet}`);
    expect(message).toContain(`Basket id: ${BASKET_ID}`);
    expect(message).toContain("Basket: A basket (TEST)");
    expect(message).toContain(`Content: sha256:${contentHash(CONTENT)}`);
    expect(message).toContain(
      `Request: sha256:${payloadHash(challenge.payload)}`,
    );
    expect(message).toContain("Expires: 2026-11-13T12:05:00.000Z");
    expect(message).toContain("It does not move funds");
    expect(
      challengeMessage(challenge.payload, ["Basket: A basket (TEST)"]),
    ).toBe(message);
  });

  it("refuses another site", async () => {
    const { store, request } = await issued();
    expect(
      await detailOf(() =>
        verifyChallenge(
          store,
          { ...request, origin: "https://other.test" },
          { now: NOW + 1 },
        ),
      ),
    ).toBe("UNAUTHORIZED:mismatch:origin");
  });

  it("refuses an expired approval", async () => {
    const { store, request } = await issued();
    expect(
      await detailOf(() =>
        verifyChallenge(store, request, {
          now: NOW + CHALLENGE_TTL_SECONDS * 1000,
        }),
      ),
    ).toBe("UNAUTHORIZED:expired");
  });

  it("refuses a signature that is not the owner's", async () => {
    const { store, request } = await issued();
    expect(
      await detailOf(() =>
        verifyChallenge(
          store,
          { ...request, signature: Buffer.alloc(64).toString("base64") },
          { now: NOW + 1 },
        ),
      ),
    ).toBe("UNAUTHORIZED:bad-signature");
  });

  it("refuses changed content (the reviewed basket was changed)", async () => {
    const { store, request } = await issued();
    const changed = structuredClone(CONTENT);
    changed.allocations[0]!.weightBps = 9000;
    expect(
      await detailOf(() =>
        verifyChallenge(
          store,
          { ...request, content: changed },
          { now: NOW + 1 },
        ),
      ),
    ).toBe("UNAUTHORIZED:mismatch:content");
  });
});

describe("single-use nonces", () => {
  it("refuses a replay of a used challenge", async () => {
    const { store, request } = await issued();
    await verifyChallenge(store, request, { now: NOW + 1 });
    expect(
      await detailOf(() => verifyChallenge(store, request, { now: NOW + 2 })),
    ).toBe("UNAUTHORIZED:unknown-or-used-nonce");
  });

  it("lets exactly one of several concurrent verifications through", async () => {
    const { store, request } = await issued();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        verifyChallenge(store, request, { now: NOW + 1 }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("burns the nonce even when the first attempt is refused", async () => {
    const { store, request } = await issued();
    await detailOf(() =>
      verifyChallenge(store, { ...request, purpose: "delete" }, { now: NOW }),
    );
    expect(
      await detailOf(() => verifyChallenge(store, request, { now: NOW + 1 })),
    ).toBe("UNAUTHORIZED:unknown-or-used-nonce");
  });

  it("stores the payload with a TTL and refuses to overwrite a nonce", async () => {
    const calls: Array<{ key: string; ex: number; nx: boolean }> = [];
    const store: ChallengeStore = {
      async set(key, _value, options) {
        calls.push({ key, ex: options.ex, nx: options.nx });
        return null;
      },
      async getdel() {
        return null;
      },
    };
    const signer = await makeSigner();
    const outcome = await detailOf(() =>
      issueChallenge(
        store,
        {
          origin: ORIGIN,
          wallet: signer.wallet,
          purpose: "delete",
          basketId: BASKET_ID,
          content: null,
          summary: [],
        },
        { now: NOW },
      ),
    );
    expect(outcome).toBe("CONFLICT:nonce-collision");
    expect(calls[0]).toMatchObject({ ex: CHALLENGE_TTL_SECONDS, nx: true });
    expect(calls[0]!.key).toMatch(/^creator:challenge:[A-Za-z0-9_-]{32}$/);
  });

  it("treats a corrupted stored payload as unknown", async () => {
    const { store, request } = await issued();
    store.data.set(`creator:challenge:${request.nonce}`, "{not json");
    expect(
      await detailOf(() => verifyChallenge(store, request, { now: NOW })),
    ).toBe("UNAUTHORIZED:corrupt-payload");
  });
});

describe("request matching", () => {
  it.each([
    ["wallet", { wallet: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz" }],
    ["purpose", { purpose: "update" as const }],
    ["basketId", { basketId: "00000000-0000-4000-8000-000000000000" }],
  ])("refuses a different %s", async (field, change) => {
    const { store, request } = await issued();
    expect(
      await detailOf(() =>
        verifyChallenge(store, { ...request, ...change }, { now: NOW + 1 }),
      ),
    ).toBe(`UNAUTHORIZED:mismatch:${field}`);
  });

  it("supports content-free purposes (archive)", async () => {
    const { store, request, challenge } = await issued("delete");
    expect(challenge.payload.contentHash).toBe(contentHash(null));
    expect(challenge.message.split("\n")[0]).toBe(
      "Aroma: sign to archive a creator basket",
    );
    await expect(
      verifyChallenge(store, request, { now: NOW + 1 }),
    ).resolves.toMatchObject({ purpose: "delete" });
  });

  it("refuses an approval issued in the future (clock skew beyond the TTL)", async () => {
    const { store, request } = await issued();
    expect(
      await detailOf(() => verifyChallenge(store, request, { now: NOW - 1 })),
    ).toBe("UNAUTHORIZED:not-yet-valid");
  });
});

describe("input parsing", () => {
  it("accepts on-curve wallets and rejects PDAs and junk", async () => {
    const { wallet } = await makeSigner();
    expect(walletSchema.safeParse(wallet).success).toBe(true);
    // A program-derived address is off curve: it cannot sign a message.
    const [pda] = await getProgramDerivedAddress({
      programAddress: address("11111111111111111111111111111111"),
      seeds: ["aroma"],
    });
    expect(walletSchema.safeParse(pda).success).toBe(false);
    for (const bad of ["", "0OIl", "x".repeat(45), 42])
      expect(walletSchema.safeParse(bad).success).toBe(false);
  });

  it("decodes 64-byte base64 signatures only", () => {
    expect(parseSignature(Buffer.alloc(64, 7).toString("base64"))).toHaveLength(
      64,
    );
    for (const bad of [
      Buffer.alloc(63).toString("base64"),
      Buffer.alloc(65).toString("base64"),
      "!!!!",
      "a".repeat(200),
    ])
      expect(() => parseSignature(bad)).toThrow(AppError);
  });

  it("hashes content canonically: key order does not matter, values do", () => {
    expect(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    expect(() => contentHash({ a: 1n })).toThrow();
    expect(() => contentHash({ a: Number.NaN })).toThrow();
  });

  it("refuses to issue for an invalid wallet", async () => {
    expect(
      await detailOf(() =>
        issueChallenge(
          memoryStore(),
          {
            origin: ORIGIN,
            wallet: "not-a-wallet",
            purpose: "delete",
            basketId: BASKET_ID,
            content: null,
            summary: [],
          },
          { now: NOW },
        ),
      ),
    ).toBe("VALIDATION_FAILED:invalid challenge request");
  });
});
