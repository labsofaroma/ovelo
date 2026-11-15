import {
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  address,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { PreparedQuote } from "@/features/trade/server/quote";
import { memoryReceipts } from "@/features/trade/server/store";
import { createKeyring, sealAuthorization } from "@/server/auth/trade";
import { messageHash } from "@/server/auth/trade-transactions";
import {
  actionMetadata,
  actionQuoteRequest,
  actionTransaction,
  completedAction,
  CONFIRM_GRACE_MS,
  parseActionPost,
  recordActionPurchase,
} from "./actions";

/** M5b B4: v1 Solana Actions on M4's quote and build, and the receipt callback. */
const ORIGIN = "https://aroma.example";
const BASKET = {
  id: "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20",
  name: "Chips",
  ticker: "CHIPS",
};
const ACCOUNT = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const code = async (run: () => Promise<unknown> | unknown) => {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "THREW";
  }
};

describe("parseActionPost", () => {
  const search = (q: string) => new URLSearchParams(q);
  it("accepts a USDC amount with up to six decimals and the signing account", () => {
    expect(parseActionPost(search("amount=2.5"), { account: ACCOUNT })).toEqual(
      {
        account: ACCOUNT,
        amount: "2.5",
      },
    );
    expect(
      parseActionPost(search("amount=1"), {
        account: ACCOUNT,
        data: {},
        type: "transaction",
      }).amount,
    ).toBe("1");
  });
  it.each([
    ["no amount", "", { account: ACCOUNT }],
    ["zero", "amount=0", { account: ACCOUNT }],
    ["seven decimals", "amount=1.0000001", { account: ACCOUNT }],
    ["negative", "amount=-1", { account: ACCOUNT }],
    ["duplicate", "amount=1&amount=2", { account: ACCOUNT }],
    ["extra parameter", "amount=1&slippage=500", { account: ACCOUNT }],
    ["no account", "amount=1", {}],
    ["not an address", "amount=1", { account: "nope" }],
    ["extra body key", "amount=1", { account: ACCOUNT, inputMint: USDC }],
    ["data with fields", "amount=1", { account: ACCOUNT, data: { x: 1 } }],
  ])("refuses %s", async (_name, q, body) => {
    expect(await code(() => parseActionPost(search(q), body))).toBe(
      "VALIDATION_FAILED",
    );
  });
  it("quotes USDC in, V0 transactions, 1% slippage, the basket as the target", () => {
    expect(
      actionQuoteRequest(BASKET.id, { account: ACCOUNT, amount: "2" }),
    ).toEqual({
      target: { kind: "basket", basketId: BASKET.id },
      inputMint: USDC,
      amount: "2",
      taker: ACCOUNT,
      slippageBps: 100,
      supportedTransactionVersions: [0],
    });
  });
});

describe("actionMetadata", () => {
  it("is a mainnet spot purchase with an absolute icon and an amount parameter", () => {
    const meta = actionMetadata(BASKET, ORIGIN);
    expect(meta.type).toBe("action");
    expect(meta.icon).toBe(`${ORIGIN}/og.png`);
    expect(meta.title).toMatch(/Mainnet spot purchase/);
    expect(meta.description).toMatch(/No partial basket/);
    expect(meta.links?.actions[0]).toMatchObject({
      type: "transaction",
      href: `${ORIGIN}/api/v1/actions/baskets/${BASKET.id}?amount={amount}`,
      parameters: [{ name: "amount", required: true }],
    });
  });
});

const prepared = (overrides: Partial<PreparedQuote> = {}) =>
  ({
    requestId: "r",
    authorization: "at1.kid.body.mac",
    transactions: ["dHg="],
    mode: "single",
    transactionVersion: 0,
    expiresAt: 0,
    lastValidBlockHeight: 1,
    quote: {
      inAmount: "2000000",
      maxDebit: "2000050",
      legs: [{ symbol: "AAPLx", minimumAmount: "123" }],
    },
    ...overrides,
  }) as unknown as PreparedQuote;

describe("actionTransaction", () => {
  it("returns the one unsigned transaction and a links.next callback carrying the authorization", () => {
    const response = actionTransaction(prepared(), BASKET, ORIGIN);
    expect(response).toMatchObject({
      type: "transaction",
      transaction: "dHg=",
    });
    expect(response.message).toMatch(/Mainnet spot purchase/);
    expect(response.links?.next).toEqual({
      type: "post",
      href: `${ORIGIN}/api/v1/actions/baskets/${BASKET.id}/confirm?authorization=at1.kid.body.mac`,
    });
  });
  it("a basket that needs a bundle is refused with a link to buy it on Aroma (no partial order)", () => {
    const run = () =>
      actionTransaction(
        prepared({ mode: "bundle", transactions: ["a", "b"] }),
        BASKET,
        ORIGIN,
      );
    expect(run).toThrow(
      expect.objectContaining({ code: "BUNDLE_UNAVAILABLE" }),
    );
    try {
      run();
    } catch (error) {
      expect((error as { publicMessage: string }).publicMessage).toContain(
        `${ORIGIN}/basket/${BASKET.id}`,
      );
    }
  });
});

describe("recordActionPurchase", () => {
  const keyring = createKeyring("k".repeat(40));
  const NOW = 1_800_000_000_000;

  async function signedPurchase(options: { err?: unknown } = {}) {
    const keys = await generateKeyPair();
    const taker = await getAddressFromPublicKey(keys.publicKey);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(taker, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "11111111111111111111111111111111" as Blockhash,
            lastValidBlockHeight: 10n,
          },
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address(
              "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
            ),
            data: new Uint8Array([1]),
          },
          m,
        ),
    );
    const signed = await signTransaction([keys], compileTransaction(message));
    const signature = getSignatureFromTransaction(signed);
    const authorization = sealAuthorization(
      {
        kind: "trade",
        requestId: "11111111-1111-4111-8111-111111111111",
        taker,
        expiresAt: NOW,
        lastValidBlockHeight: 10,
        transactionVersion: 0,
        messageHashes: [messageHash(signed.messageBytes)],
        receipt: {
          kind: "basket",
          basketId: BASKET.id,
          basketVersion: 2,
          inputMint: USDC,
          inAmount: "2000050",
          legs: [
            {
              mint: ACCOUNT,
              inputAmount: "2000000",
              outAmount: "5",
              minimumAmount: "4",
              tx: 0,
            },
          ],
        },
      },
      keyring,
    );
    const onChain = {
      slot: 99,
      blockTime: NOW / 1000 + 5,
      meta: { err: options.err ?? null },
      transaction: [getBase64EncodedWireTransaction(signed), "base64"],
    };
    const receipts = memoryReceipts();
    const deps = (found: unknown = onChain, now = NOW + 30_000) => ({
      keyring,
      receipts,
      now: () => now,
      rpc: (async () => found) as unknown as Parameters<
        typeof recordActionPurchase
      >[1]["rpc"],
    });
    return { taker, signature, authorization, deps, receipts, onChain };
  }

  it("M11: marks the purchase as made through the Action; a failing mark changes nothing", async () => {
    const p = await signedPurchase();
    const marked: string[] = [];
    const input = {
      basketId: BASKET.id,
      authorization: p.authorization,
      body: { account: p.taker, signature: p.signature },
    };
    await recordActionPurchase(input, {
      ...p.deps(),
      markAction: async (signature) => void marked.push(signature),
    });
    expect(marked).toEqual([p.signature]);
    const q = await signedPurchase();
    const result = await recordActionPurchase(
      {
        ...input,
        authorization: q.authorization,
        body: { account: q.taker, signature: q.signature },
      },
      {
        ...q.deps(),
        markAction: async () => Promise.reject(new Error("db down")),
      },
    );
    expect(result).toEqual({
      status: "confirmed",
      requestId: expect.any(String),
    });
  });

  it("records a confirmed receipt for the authorized transaction read back from mainnet", async () => {
    const p = await signedPurchase();
    const result = await recordActionPurchase(
      {
        basketId: BASKET.id,
        authorization: p.authorization,
        body: { account: p.taker, signature: p.signature },
      },
      p.deps(),
    );
    expect(result).toEqual({
      status: "confirmed",
      requestId: expect.any(String),
    });
    const [row] = await p.receipts.listByWallet(p.taker, 5);
    expect(row).toMatchObject({
      signature: p.signature,
      basketId: BASKET.id,
      status: "confirmed",
      amountIn: "2000000",
      slot: 99n,
    });
    expect(row!.legs[0]).toMatchObject({
      basketVersion: 2,
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    // Idempotent: calling back twice changes nothing.
    await recordActionPurchase(
      {
        basketId: BASKET.id,
        authorization: p.authorization,
        body: { account: p.taker, signature: p.signature },
      },
      p.deps(),
    );
    expect(await p.receipts.listByWallet(p.taker, 5)).toHaveLength(1);
  });

  it("an on-chain failure is recorded as failed (and so never counted in stats)", async () => {
    const p = await signedPurchase({
      err: { InstructionError: [0, "Custom"] },
    });
    expect(
      await recordActionPurchase(
        {
          basketId: BASKET.id,
          authorization: p.authorization,
          body: { account: p.taker, signature: p.signature },
        },
        p.deps(),
      ),
    ).toEqual({ status: "failed", requestId: expect.any(String) });
  });

  it("refuses anything that is not exactly the authorized purchase", async () => {
    const p = await signedPurchase();
    const other = await signedPurchase();
    const body = { account: p.taker, signature: p.signature };
    const run = (
      input: Partial<Parameters<typeof recordActionPurchase>[0]>,
      deps = p.deps(),
    ) =>
      code(() =>
        recordActionPurchase(
          {
            basketId: BASKET.id,
            authorization: p.authorization,
            body,
            ...input,
          },
          deps,
        ),
      );
    expect(await run({ authorization: null })).toBe("AUTHORIZATION_INVALID");
    expect(await run({ authorization: `${p.authorization}x` })).toBe(
      "AUTHORIZATION_INVALID",
    );
    expect(await run({ basketId: "sol-core" })).toBe("AUTHORIZATION_INVALID");
    expect(
      await run({ body: { account: ACCOUNT, signature: p.signature } }),
    ).toBe("AUTHORIZATION_INVALID");
    expect(
      await run(
        { body: { account: p.taker, signature: other.signature } },
        p.deps({
          slot: 1,
          blockTime: null,
          meta: { err: null },
          transaction: [
            // Another wallet's valid transaction is not this authorization's message.
            other.onChain.transaction[0],
            "base64",
          ],
        }),
      ),
    ).toBe("TRANSACTION_MISMATCH");
    expect(await run({}, p.deps(null))).toBe("CONFLICT");
    expect(
      await run(
        {},
        p.deps(undefined, 1_800_000_000_000 + CONFIRM_GRACE_MS + 1),
      ),
    ).toBe("QUOTE_EXPIRED");
    expect(await run({ body: { account: p.taker } })).toBe("VALIDATION_FAILED");
    expect(await p.receipts.listByWallet(p.taker, 5)).toEqual([]);
  });
});

describe("completedAction", () => {
  it("says what happened, in words", () => {
    expect(completedAction(ORIGIN, "confirmed")).toMatchObject({
      type: "completed",
      label: "Confirmed",
    });
    expect(completedAction(ORIGIN, "failed").description).toMatch(
      /No basket was bought/,
    );
  });
});
