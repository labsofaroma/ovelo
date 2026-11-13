import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { signer, testKeypair, v0Transfer } from "../test/transactions";
import {
  createKeyring,
  openAuthorization,
  rawAmountSchema,
  sealAuthorization,
  type TradePayload,
} from "./trade";
import {
  authorizeTransactions,
  verifySignedTransactions,
} from "./trade-transactions";

/** Property tests for the money path (REWRITE-PLAN §8): tampering, expiry, signer, replay. */
const keyring = createKeyring("property-test-trade-secret-not-for-production");
const taker = signer.publicKey.toBase58();
const NOW = 1_800_000_000_000;

function payload(overrides: Partial<TradePayload> = {}): TradePayload {
  return {
    kind: "trade",
    requestId: "8f0e3c7a-3d4b-4b8e-9c2a-1f6d5e4c3b2a",
    taker,
    expiresAt: NOW + 60_000,
    lastValidBlockHeight: 100,
    transactionVersion: 0,
    messageHashes: ["ab".repeat(32)],
    receipt: {
      kind: "spot",
      basketId: null,
      inputMint: testKeypair(2).publicKey.toBase58(),
      inAmount: "1000000",
      legs: [
        {
          mint: testKeypair(4).publicKey.toBase58(),
          outAmount: "5",
          minimumAmount: "4",
        },
      ],
    },
    ...overrides,
  };
}
const codeOf = (run: () => unknown): string => {
  try {
    run();
    return "ok";
  } catch (error) {
    return error instanceof AppError ? error.code : "THREW";
  }
};

describe("authorization properties", () => {
  it("any single-character change anywhere in the token is rejected", () => {
    const token = sealAuthorization(payload(), keyring);
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
    fc.assert(
      fc.property(
        fc.nat({ max: token.length - 1 }),
        fc.constantFrom(...alphabet.split("")),
        (index, replacement) => {
          fc.pre(token[index] !== replacement);
          const tampered =
            token.slice(0, index) + replacement + token.slice(index + 1);
          // base64url can encode the same bytes two ways only in its final padding bits; a change
          // there that decodes to identical bytes is not a tamper, so require a real difference.
          const same =
            tampered
              .split(".")
              .map((part) => {
                try {
                  return Buffer.from(part, "base64url").toString("hex");
                } catch {
                  return part;
                }
              })
              .join(".") ===
            token
              .split(".")
              .map((part) => Buffer.from(part, "base64url").toString("hex"))
              .join(".");
          fc.pre(!same);
          expect(
            codeOf(() => openAuthorization(tampered, keyring, { now: NOW })),
          ).toBe("AUTHORIZATION_INVALID");
        },
      ),
      { numRuns: 400 },
    );
  });

  it("any payload field changed and re-encoded with the original MAC is rejected", () => {
    const token = sealAuthorization(payload(), keyring);
    const [version, kid, , mac] = token.split(".") as [
      string,
      string,
      string,
      string,
    ];
    fc.assert(
      fc.property(
        fc.record({
          inAmount: fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
          expiresAt: fc.integer({ min: NOW + 1, max: NOW + 10 ** 9 }),
          lastValidBlockHeight: fc.integer({ min: 1, max: 10 ** 9 }),
        }),
        (change) => {
          const altered = payload({
            expiresAt: change.expiresAt,
            lastValidBlockHeight: change.lastValidBlockHeight,
          });
          altered.receipt.inAmount = change.inAmount.toString();
          fc.pre(JSON.stringify(altered) !== JSON.stringify(payload()));
          const body = Buffer.from(JSON.stringify(altered)).toString(
            "base64url",
          );
          expect(
            codeOf(() =>
              openAuthorization(`${version}.${kid}.${body}.${mac}`, keyring, {
                now: NOW,
              }),
            ),
          ).toBe("AUTHORIZATION_INVALID");
        },
      ),
    );
  });

  it("expiry: valid strictly before expiresAt, QUOTE_EXPIRED at or after it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 ** 12 }),
        fc.integer({ min: -(10 ** 9), max: 10 ** 9 }),
        (expiresAt, offset) => {
          const token = sealAuthorization(payload({ expiresAt }), keyring);
          const now = expiresAt + offset;
          expect(codeOf(() => openAuthorization(token, keyring, { now }))).toBe(
            now < expiresAt ? "ok" : "QUOTE_EXPIRED",
          );
        },
      ),
    );
  });

  it("raw amounts: every u64 integer string is accepted, nothing else", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (value) => {
        expect(rawAmountSchema.safeParse(value.toString()).success).toBe(true);
      }),
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.bigInt({ min: 2n ** 64n, max: 2n ** 80n }).map(String),
          fc.bigInt({ min: -(2n ** 64n), max: -1n }).map(String),
          fc.double({ noInteger: true, noNaN: true }).map(String),
          fc.string().filter((s) => !/^(0|[1-9]\d*)$/.test(s)),
          fc.nat().map((n) => `0${n}`),
        ),
        (value) => {
          expect(rawAmountSchema.safeParse(value).success).toBe(false);
        },
      ),
    );
  });
});

describe("transaction properties", () => {
  it("signer mismatch: a transaction signed by any other wallet is never accepted", async () => {
    const unsigned = v0Transfer(7);
    const { authorization } = await authorizeTransactions(
      {
        transactions: [unsigned],
        taker,
        expiresAt: Date.now() + 60_000,
        lastValidBlockHeight: 100,
        receipt: payload().receipt,
      },
      keyring,
    );
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 10, max: 250 }), async (seed) => {
        const other = testKeypair(seed);
        // Same lamports, other payer: the message differs, so it is not the authorized bytes.
        const signedByOther = v0Transfer(7, { signed: true, by: other });
        await expect(
          verifySignedTransactions(authorization, [signedByOther], keyring),
        ).rejects.toBeInstanceOf(AppError);
      }),
      { numRuns: 25 },
    );
  });

  it("replay: one authorization never accepts another order's transactions, and re-verifying yields the same request id", async () => {
    const meta = {
      taker,
      expiresAt: Date.now() + 60_000,
      lastValidBlockHeight: 100,
      receipt: payload().receipt,
    };
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        async (a, b) => {
          fc.pre(a !== b);
          const first = await authorizeTransactions(
            { ...meta, transactions: [v0Transfer(a)] },
            keyring,
          );
          const signedA = v0Transfer(a, { signed: true });
          const signedB = v0Transfer(b, { signed: true });
          const once = await verifySignedTransactions(
            first.authorization,
            [signedA],
            keyring,
          );
          const twice = await verifySignedTransactions(
            first.authorization,
            [signedA],
            keyring,
          );
          // The request id is the idempotency key the submit route stores before broadcasting.
          expect(once.requestId).toBe(first.requestId);
          expect(twice.requestId).toBe(first.requestId);
          await expect(
            verifySignedTransactions(first.authorization, [signedB], keyring),
          ).rejects.toMatchObject({ code: "TRANSACTION_MISMATCH" });
        },
      ),
      { numRuns: 20 },
    );
  });
});
