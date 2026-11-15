import {
  address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { actionMessageHash } from "@/features/baskets/actions";
import type { PreparedQuote } from "@/features/trade/server/quote";
import type { MainnetRpc } from "@/features/trade/server/rpc";
import { messageHash } from "@/server/auth/trade-transactions";
import { actionOutcome } from "./action-outcome";

const CREATED = new Date(1_800_000_000_000);
const SEC = CREATED.getTime() / 1000;

async function wireTransaction(memo: number) {
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
          data: new Uint8Array([memo]),
        },
        m,
      ),
  );
  const signed = await signTransaction([keys], compileTransaction(message));
  return {
    hash: messageHash(signed.messageBytes),
    wire: getBase64EncodedWireTransaction(signed),
  };
}

type Chain = {
  signatures: { signature: string; blockTime: number | null }[];
  transactions: Record<string, { err: unknown; wire: string } | null>;
};
const rpcFor = (chain: Chain, calls: string[] = []) =>
  (async (method: string, params: unknown[]) => {
    calls.push(method);
    if (method === "getSignaturesForAddress") {
      const before = (params[1] as { before?: string }).before;
      const start = before
        ? chain.signatures.findIndex((s) => s.signature === before) + 1
        : 0;
      return chain.signatures.slice(start, start + 100);
    }
    if (method === "getTransaction") {
      const tx = chain.transactions[params[0] as string];
      return tx
        ? { meta: { err: tx.err }, transaction: [tx.wire, "base64"] }
        : null;
    }
    throw new Error(`unexpected ${method}`);
  }) as unknown as MainnetRpc;

const reservation = (hash: string) => ({
  wallet: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  actionMessageHash: hash,
  createdAt: CREATED,
});

describe("actionOutcome (W3 caps for Solana Actions)", () => {
  it("finds the authorized message among the wallet's transactions", async () => {
    const mine = await wireTransaction(1);
    const other = await wireTransaction(2);
    const chain: Chain = {
      signatures: [
        { signature: "s2", blockTime: SEC + 30 },
        { signature: "s1", blockTime: SEC + 10 },
        { signature: "old", blockTime: SEC - 3600 },
      ],
      transactions: {
        s2: { err: null, wire: other.wire },
        s1: { err: null, wire: mine.wire },
      },
    };
    expect(await actionOutcome(reservation(mine.hash), rpcFor(chain))).toBe(
      "confirmed",
    );
    chain.transactions.s1 = {
      err: { InstructionError: [0, {}] },
      wire: mine.wire,
    };
    expect(await actionOutcome(reservation(mine.hash), rpcFor(chain))).toBe(
      "failed",
    );
  });

  it("is failed (released) when every transaction since the quote was searched and none matches", async () => {
    const mine = await wireTransaction(1);
    const other = await wireTransaction(2);
    const calls: string[] = [];
    const chain: Chain = {
      signatures: [
        { signature: "s1", blockTime: SEC + 10 },
        { signature: "old", blockTime: SEC - 3600 },
      ],
      transactions: { s1: { err: null, wire: other.wire } },
    };
    expect(
      await actionOutcome(reservation(mine.hash), rpcFor(chain, calls)),
    ).toBe("failed");
    // The transaction older than the quote is never fetched.
    expect(calls.filter((c) => c === "getTransaction")).toHaveLength(1);
    expect(
      await actionOutcome(
        reservation(mine.hash),
        rpcFor({ signatures: [], transactions: {} }),
      ),
    ).toBe("failed");
  });

  it("stays open (keeps counting) when it cannot decide", async () => {
    const mine = await wireTransaction(1);
    // Listed but not readable yet.
    expect(
      await actionOutcome(
        reservation(mine.hash),
        rpcFor({
          signatures: [{ signature: "s1", blockTime: SEC + 10 }],
          transactions: { s1: null },
        }),
      ),
    ).toBe("open");
    // More recent transactions than three pages can cover.
    const many = Array.from({ length: 300 }, (_, i) => ({
      signature: `s${i}`,
      blockTime: SEC + 300 - i,
    }));
    expect(
      await actionOutcome(
        reservation(mine.hash),
        rpcFor({ signatures: many, transactions: {} }),
      ),
    ).toBe("open");
    // An RPC error.
    expect(
      await actionOutcome(reservation(mine.hash), (async () => {
        throw new Error("down");
      }) as unknown as MainnetRpc),
    ).toBe("open");
  });

  it("actionMessageHash is the SHA-256 of the quoted transaction's message", async () => {
    const mine = await wireTransaction(7);
    expect(
      actionMessageHash({
        transactions: [mine.wire],
      } as unknown as PreparedQuote),
    ).toBe(mine.hash);
  });
});
