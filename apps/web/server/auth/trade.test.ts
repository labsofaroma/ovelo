import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import {
  blockhash,
  otherSigner,
  signEncoded,
  signer,
  testKeypair,
  v0Transfer,
  v1Transfer,
} from "../test/transactions";
import { createKeyring, openAuthorization, sealAuthorization } from "./trade";
import {
  authorizeTransactions,
  inspectTradeTransaction,
  verifySignedTransactions,
} from "./trade-transactions";

/**
 * Ported from the prototype suites (REWRITE-PLAN §8): tests/trading.test.mjs,
 * tests/bundle-authorization.test.ts and the authorization half of
 * tests/composed-transactions.test.ts. The prototype had three token kinds (trade, composed,
 * bundle); v1 has one, so each original assertion is kept against `authorizeTransactions` /
 * `verifySignedTransactions` with one (single) or several (bundle) transactions.
 */
const SECRET = "unit-test-trade-secret-not-a-production-key-0001";
const keyring = createKeyring(SECRET);
const taker = signer.publicKey.toBase58();
const receipt = {
  kind: "basket" as const,
  basketId: "creator-0123456789abcdef01234567",
  inputMint: testKeypair(2).publicKey.toBase58(),
  inAmount: "12345678901234567",
  legs: [
    {
      mint: testKeypair(4).publicKey.toBase58(),
      inputAmount: "12345678901234567",
      outAmount: "100",
      minimumAmount: "99",
      tx: 0,
    },
  ],
};
const meta = (expiresAt = Date.now() + 60_000) => ({
  taker,
  expiresAt,
  lastValidBlockHeight: 100,
  receipt,
});
const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) =>
      error instanceof AppError ? error.code : String(error),
  );

const syncCode = (run: () => unknown) => {
  try {
    run();
    return "returned";
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
};

describe("single transaction (trading.test.mjs, composed-transactions.test.ts)", () => {
  it("only the reviewed message with a valid wallet signature can execute", async () => {
    const unsigned = v0Transfer(1);
    const { authorization, requestId } = await authorizeTransactions(
      { ...meta(), transactions: [unsigned] },
      keyring,
    );
    // Unsigned: rejected for the signature.
    expect(
      await code(verifySignedTransactions(authorization, [unsigned], keyring)),
    ).toBe("SIGNATURE_INVALID");
    const signed = v0Transfer(1, { signed: true });
    const payload = await verifySignedTransactions(
      authorization,
      [signed],
      keyring,
    );
    expect(payload.requestId).toBe(requestId);
    // Wrong secret.
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [signed],
          createKeyring("a-different-secret-that-is-at-least-32-chars"),
        ),
      ),
    ).toBe("AUTHORIZATION_INVALID");
    // A different blockhash (a different message), signed by the same wallet.
    const changed = v0Transfer(1, {
      signed: true,
      recentBlockhash: testKeypair(7).publicKey.toBase58(),
    });
    expect(
      await code(verifySignedTransactions(authorization, [changed], keyring)),
    ).toBe("TRANSACTION_MISMATCH");
  });

  it("an expired quote and a different wallet cannot be approved", async () => {
    const { authorization } = await authorizeTransactions(
      { ...meta(Date.now() - 1), transactions: [v0Transfer(1)] },
      keyring,
    );
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [v0Transfer(1, { signed: true })],
          keyring,
        ),
      ),
    ).toBe("QUOTE_EXPIRED");
    // A transaction that another wallet pays for cannot be authorized for this taker.
    expect(
      await code(
        authorizeTransactions(
          { ...meta(), transactions: [v0Transfer(1, { by: otherSigner })] },
          keyring,
        ),
      ),
    ).toBe("FORBIDDEN");
  });

  it("a tampered authorization (any character of payload or MAC) is rejected", async () => {
    const { authorization } = await authorizeTransactions(
      { ...meta(), transactions: [v0Transfer(1)] },
      keyring,
    );
    expect(() =>
      openAuthorization(`${authorization}bad`, keyring),
    ).toThrowError(AppError);
    const [version, kid, body, mac] = authorization.split(".") as [
      string,
      string,
      string,
      string,
    ];
    const changed = JSON.parse(Buffer.from(body, "base64url").toString());
    changed.receipt.inAmount = "9999";
    const forged = `${version}.${kid}.${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${mac}`;
    expect(syncCode(() => openAuthorization(forged, keyring))).toBe(
      "AUTHORIZATION_INVALID",
    );
  });

  it("v1 transactions bind version and message (composed-transactions.test.ts)", async () => {
    const unsigned = await v1Transfer(1);
    const { authorization } = await authorizeTransactions(
      { ...meta(), transactions: [unsigned] },
      keyring,
    );
    const payload = await verifySignedTransactions(
      authorization,
      [await signEncoded(unsigned)],
      keyring,
    );
    expect(payload.transactionVersion).toBe(1);
    // A v0 transaction with a valid signature is not the authorized v1 message.
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [v0Transfer(1, { signed: true })],
          keyring,
        ),
      ),
    ).toBe("TRANSACTION_MISMATCH");
  });
});

describe("bundles (bundle-authorization.test.ts)", () => {
  it("binds count, ordering, wallet, amount and every signed message", async () => {
    const { authorization, payload } = await authorizeTransactions(
      { ...meta(), transactions: [v0Transfer(1), v0Transfer(2)] },
      keyring,
    );
    expect(payload.receipt.inAmount).toBe(receipt.inAmount);
    const s1 = v0Transfer(1, { signed: true });
    const s2 = v0Transfer(2, { signed: true });
    expect(
      (await verifySignedTransactions(authorization, [s1, s2], keyring)).receipt
        .inAmount,
    ).toBe(receipt.inAmount);
    expect(
      await code(verifySignedTransactions(authorization, [s2, s1], keyring)),
    ).toBe("TRANSACTION_MISMATCH");
    expect(
      await code(verifySignedTransactions(authorization, [s1], keyring)),
    ).toBe("TRANSACTION_MISMATCH");
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [s1, v0Transfer(3, { signed: true })],
          keyring,
        ),
      ),
    ).toBe("TRANSACTION_MISMATCH");
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [v0Transfer(1), v0Transfer(2)],
          keyring,
        ),
      ),
    ).toBe("SIGNATURE_INVALID");
  });

  it("duplicate messages and expired quotes fail closed", async () => {
    expect(
      await code(
        authorizeTransactions(
          { ...meta(), transactions: [v0Transfer(1), v0Transfer(1)] },
          keyring,
        ),
      ),
    ).toBe("BAD_REQUEST");
    const { authorization } = await authorizeTransactions(
      { ...meta(1), transactions: [v0Transfer(1), v0Transfer(2)] },
      keyring,
    );
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [v0Transfer(1, { signed: true }), v0Transfer(2, { signed: true })],
          keyring,
        ),
      ),
    ).toBe("QUOTE_EXPIRED");
    // Read-only recovery may inspect an expired authorization, never a forged one.
    expect(
      (
        await verifySignedTransactions(
          authorization,
          [v0Transfer(1, { signed: true }), v0Transfer(2, { signed: true })],
          keyring,
          { allowExpired: true },
        )
      ).expiresAt,
    ).toBe(1);
  });

  it("five v1 messages stay ordered, signed and version-bound; mixed and six-message bundles reject", async () => {
    const transactions = await Promise.all(
      [1, 2, 3, 4, 5].map((amount) => v1Transfer(amount, 1300)),
    );
    expect(Buffer.from(transactions[0]!, "base64").length).toBeGreaterThan(
      1232,
    );
    const signed = await Promise.all(transactions.map((tx) => signEncoded(tx)));
    const { authorization } = await authorizeTransactions(
      { ...meta(), transactions },
      keyring,
    );
    expect(
      (await verifySignedTransactions(authorization, signed, keyring))
        .transactionVersion,
    ).toBe(1);
    expect(
      await code(
        verifySignedTransactions(authorization, [...signed].reverse(), keyring),
      ),
    ).toBe("TRANSACTION_MISMATCH");
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          [v0Transfer(1, { signed: true }), ...signed.slice(1)],
          keyring,
        ),
      ),
    ).toBe("TRANSACTION_MISMATCH");
    expect(
      await code(
        authorizeTransactions(
          { ...meta(), transactions: [v0Transfer(1), transactions[0]!] },
          keyring,
        ),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await code(
        authorizeTransactions(
          { ...meta(), transactions: [...transactions, await v1Transfer(6)] },
          keyring,
        ),
      ),
    ).toBe("BAD_REQUEST");
  });
});

describe("key rotation", () => {
  it("a quote sealed with the previous key verifies during rotation, then stops", async () => {
    const old = createKeyring(
      "old-trade-secret-that-is-at-least-32-characters",
    );
    const { authorization } = await authorizeTransactions(
      { ...meta(), transactions: [v0Transfer(1)] },
      old,
    );
    const rotated = createKeyring(
      "new-trade-secret-that-is-at-least-32-characters",
      "old-trade-secret-that-is-at-least-32-characters",
    );
    const signed = [v0Transfer(1, { signed: true })];
    await expect(
      verifySignedTransactions(authorization, signed, rotated),
    ).resolves.toBeTruthy();
    // New quotes use the new key id.
    const fresh = await authorizeTransactions(
      { ...meta(), transactions: [v0Transfer(1)] },
      rotated,
    );
    expect(fresh.authorization.split(".")[1]).toBe(rotated.current.kid);
    // Once the previous key is dropped, old quotes fail closed.
    expect(
      await code(
        verifySignedTransactions(
          authorization,
          signed,
          createKeyring("new-trade-secret-that-is-at-least-32-characters"),
        ),
      ),
    ).toBe("AUTHORIZATION_INVALID");
  });

  it("rejects short secrets and payloads that fail the schema", () => {
    expect(() => createKeyring("short")).toThrow();
    expect(() =>
      sealAuthorization(
        {
          kind: "trade",
          requestId: "not-a-uuid",
          taker,
          expiresAt: Date.now() + 1000,
          lastValidBlockHeight: 1,
          transactionVersion: 0,
          messageHashes: ["a".repeat(64)],
          receipt,
        },
        keyring,
      ),
    ).toThrow();
  });
});

describe("inspection limits (composed-transactions.test.ts)", () => {
  it("refuses malformed, oversized and non-base64 input", async () => {
    for (const bad of [null, 42, "", "!!!", "A".repeat(6000)])
      expect(await code(inspectTradeTransaction(bad))).toBe("BAD_REQUEST");
    expect(blockhash).toBeTruthy();
  });
});
