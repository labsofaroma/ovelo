import fc from "fast-check";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  authorizePlanTransaction,
  openPlanAuthorization,
  sealPlanAuthorization,
  verifySignedPlanTransaction,
  type PlanPayload,
} from "./plan";
import { createKeyring, sealAuthorization } from "./trade";

const keyring = createKeyring("p".repeat(40));
const NOW = 1_763_100_000_000;
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;

async function unsigned(payer: string, extraSigner?: KeyPairSigner) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) =>
      setTransactionMessageFeePayerSigner(createNoopSigner(payer as never), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash:
            "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k" as Blockhash,
          lastValidBlockHeight: 900n,
        },
        m,
      ),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: MEMO,
            accounts: extraSigner
              ? [{ address: extraSigner.address, role: 2 }]
              : [],
            data: new TextEncoder().encode("plan"),
          },
        ],
        m,
      ),
  );
  return compileTransaction(message);
}

const base = (
  owner: string,
): Omit<PlanPayload, "requestId" | "messageHash"> => ({
  kind: "plan_create",
  owner,
  plan: "11111111111111111111111111111112",
  cluster: "devnet",
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  expiresAt: NOW + 90_000,
  lastValidBlockHeight: "900",
  receipt: {
    fundingMint: "11111111111111111111111111111112",
    nonce: "1",
    installmentRaw: "10",
    periods: 4,
    outputs: [],
  },
});

async function signedPair(owner: KeyPairSigner) {
  const tx = await unsigned(owner.address);
  const { authorization } = authorizePlanTransaction(
    {
      ...base(owner.address),
      transaction: getBase64EncodedWireTransaction(tx),
    },
    keyring,
  );
  const signed = await partiallySignTransaction([owner.keyPair], tx);
  return { authorization, signed: getBase64EncodedWireTransaction(signed), tx };
}

describe("plan authorizations (pa1)", () => {
  it("a signed, untouched transaction verifies; the payload is bound to the owner", async () => {
    const owner = await generateKeyPairSigner();
    const { authorization, signed } = await signedPair(owner);
    const { payload } = verifySignedPlanTransaction(
      authorization,
      signed,
      keyring,
      { now: NOW },
    );
    expect(payload.owner).toBe(owner.address);
    expect(payload.kind).toBe("plan_create");
  });

  it("refuses expiry, an unknown key, a trade token, and a plan token offered as a trade token", async () => {
    const owner = await generateKeyPairSigner();
    const { authorization } = await signedPair(owner);
    expect(() =>
      openPlanAuthorization(authorization, keyring, { now: NOW + 91_000 }),
    ).toThrow(expect.objectContaining({ code: "QUOTE_EXPIRED" }));
    expect(() =>
      openPlanAuthorization(authorization, createKeyring("q".repeat(40)), {
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: "AUTHORIZATION_INVALID" }));
    const trade = sealAuthorization(
      {
        kind: "trade",
        requestId: "8d1f4c2e-3b6a-4f7e-9a10-2b3c4d5e6f70",
        taker: owner.address,
        expiresAt: NOW + 60_000,
        lastValidBlockHeight: 10,
        transactionVersion: 0,
        messageHashes: ["a".repeat(64)],
        receipt: {
          kind: "spot",
          basketId: null,
          inputMint: owner.address,
          inAmount: "1",
          legs: [
            {
              mint: owner.address,
              inputAmount: "1",
              outAmount: "1",
              minimumAmount: "1",
              tx: 0,
            },
          ],
        },
      },
      keyring,
    );
    expect(() => openPlanAuthorization(trade, keyring, { now: NOW })).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_INVALID" }),
    );
    // Same kid and body, plan prefix swapped in: the MAC key differs by purpose.
    const forged = `pa1.${trade.split(".").slice(1).join(".")}`;
    expect(() => openPlanAuthorization(forged, keyring, { now: NOW })).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_INVALID" }),
    );
  });

  it("property: changing any character of the token is refused", async () => {
    const owner = await generateKeyPairSigner();
    const { authorization } = await signedPair(owner);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: authorization.length - 1 }),
        fc.constantFrom("A", "b", "9", "_", "-", "."),
        (i, c) => {
          fc.pre(authorization[i] !== c);
          const tampered =
            authorization.slice(0, i) + c + authorization.slice(i + 1);
          // base64url can spell the same bytes two ways in its final padding bits; a change there
          // that decodes to identical bytes is not a tamper (as in trade.property.test.ts).
          const bytes = (t: string) =>
            t
              .split(".")
              .map((part) => Buffer.from(part, "base64url").toString("hex"))
              .join(".");
          fc.pre(bytes(tampered) !== bytes(authorization));
          expect(() =>
            openPlanAuthorization(tampered, keyring, { now: NOW }),
          ).toThrow();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("refuses different bytes, a missing or wrong signature, and an extra signer", async () => {
    const owner = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    const { authorization, tx } = await signedPair(owner);
    const different = await partiallySignTransaction(
      [owner.keyPair],
      await unsigned(owner.address, other),
    );
    expect(() =>
      verifySignedPlanTransaction(
        authorization,
        getBase64EncodedWireTransaction(different),
        keyring,
        { now: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSACTION_MISMATCH" }));
    expect(() =>
      verifySignedPlanTransaction(
        authorization,
        getBase64EncodedWireTransaction(tx),
        keyring,
        { now: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALID" }));
    const bytes = getBase64Encoder().encode(
      getBase64EncodedWireTransaction(
        await partiallySignTransaction([owner.keyPair], tx),
      ),
    );
    const decoded = getTransactionDecoder().decode(bytes) as Transaction;
    const wrong = {
      ...decoded,
      signatures: { [owner.address]: new Uint8Array(64).fill(7) },
    } as unknown as Transaction;
    expect(() =>
      verifySignedPlanTransaction(
        authorization,
        getBase64EncodedWireTransaction(wrong),
        keyring,
        { now: NOW },
      ),
    ).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALID" }));
    await expect(async () =>
      authorizePlanTransaction(
        {
          ...base(owner.address),
          transaction: getBase64EncodedWireTransaction(
            await unsigned(owner.address, other),
          ),
        },
        keyring,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() =>
      authorizePlanTransaction(
        {
          ...base(other.address),
          transaction: getBase64EncodedWireTransaction(tx),
        },
        keyring,
      ),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("refuses malformed input and an oversized token", () => {
    expect(() =>
      verifySignedPlanTransaction("x", "not base64!", keyring),
    ).toThrow();
    expect(() => openPlanAuthorization("a".repeat(5_000), keyring)).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_INVALID" }),
    );
    expect(() => openPlanAuthorization("pa1.a.b", keyring)).toThrow();
    expect(() =>
      sealPlanAuthorization(
        { kind: "nope" } as unknown as PlanPayload,
        keyring,
      ),
    ).toThrow();
  });
});
