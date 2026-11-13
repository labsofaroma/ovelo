import { expect, test } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { simulateTradeOrder } from "./simulate";

type SimArgs =
  Parameters<typeof simulateTradeOrder> extends [unknown, ...infer Rest]
    ? Rest
    : never;
/** The fake RPCs here implement only simulateTransaction; the cast keeps each fake small. */
const sim = (connection: unknown, ...rest: SimArgs) =>
  simulateTradeOrder(connection as never, ...rest);
const key = () => Keypair.generate().publicKey;

function order() {
  const payer = key();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer,
      recentBlockhash: key().toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: key(),
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
  return {
    payer,
    value: {
      taker: payer.toBase58(),
      transaction: Buffer.from(tx.serialize()).toString("base64"),
    },
  };
}
test("simulation preserves sponsored blockhash and distinguishes failure from unavailability", async () => {
  const { payer, value } = order();
  let config:
    { sigVerify?: boolean; replaceRecentBlockhash?: boolean } | undefined;
  const connection = {
    simulateTransaction: async (_tx: unknown, options: typeof config) => {
      config = options;
      return { value: { err: null, unitsConsumed: 321 } };
    },
  };
  const result = await sim(connection, value, payer);
  expect(result.status).toBe("passed");
  expect(result.unitsConsumed).toBe(321);
  expect(config?.sigVerify).toBe(false);
  expect(config?.replaceRecentBlockhash).toBe(false);
  expect(
    (
      await sim(
        {
          simulateTransaction: async () => ({
            value: { err: { InstructionError: [0, "Custom"] } },
          }),
        },
        value,
        payer,
      )
    ).status,
  ).toBe("failed");
  expect(
    (
      await sim(
        {
          simulateTransaction: async () => {
            throw new Error("offline");
          },
        },
        value,
        payer,
      )
    ).status,
  ).toBe("unavailable");
  expect(
    (
      await sim(
        { simulateTransaction: async () => new Promise(() => {}) },
        value,
        payer,
        { timeoutMs: 5 },
      )
    ).status,
  ).toBe("unavailable");
  expect((await sim(connection, value, key())).status).toBe("unavailable");
  expect(
    (
      await sim(
        {
          simulateTransaction: async () => {
            throw new Error("https://rpc.test?api-key=private-value");
          },
        },
        value,
        payer,
      )
    ).error,
  ).not.toMatch(/private-value/);
  expect(
    (
      await sim(
        { simulateTransaction: async () => ({ value: {} }) },
        value,
        payer,
      )
    ).status,
  ).toBe("unavailable");
});
