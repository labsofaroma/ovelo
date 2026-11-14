import { expect, test } from "vitest";
import {
  AddressLookupTableAccount,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { composeBasketV0Chunks, composeV0Transaction } from "./bundle";

const key = (seed: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(seed);
  return Keypair.fromSeed(bytes).publicKey;
};
const payer = key(1),
  blockhash = key(2).toBase58(),
  program = key(3),
  tipAccount = key(4);
const tip = SystemProgram.transfer({
  fromPubkey: payer,
  toPubkey: tipAccount,
  lamports: 10000,
});
function fixture(count: number, accountsPerLeg = 1, dataBytes = 20) {
  const addresses = Array.from({ length: count * accountsPerLeg }, (_, i) =>
    key(i + 20),
  );
  const table = new AddressLookupTableAccount({
    key: key(10),
    state: {
      deactivationSlot: 18446744073709551615n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });
  const legs = Array.from({ length: count }, (_, i) => ({
    allocationIndex: i,
    instructions: [
      new TransactionInstruction({
        programId: program,
        data: Buffer.alloc(dataBytes, i),
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          ...addresses
            .slice(i * accountsPerLeg, (i + 1) * accountsPerLeg)
            .map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
        ],
      }),
    ],
  }));
  return {
    payer: payer.toBase58(),
    blockhash,
    legs,
    lookupTables: [table],
    basketAssetCount: count,
    finalTipInstruction: tip,
  };
}

test("small baskets compile to a single actual v0 transaction, without a Jito tip", () => {
  const options = fixture(3);
  const chunks = composeBasketV0Chunks(options);
  expect(chunks.length).toBe(1);
  const tx = VersionedTransaction.deserialize(
    Buffer.from(chunks[0]!.transaction, "base64"),
  );
  expect(tx.version).toBe(0);
  expect(chunks[0]!.serializedBytes <= 1232).toBeTruthy();
  const message = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: options.lookupTables,
  });
  expect(
    message.instructions.filter((instruction) =>
      instruction.programId.equals(SystemProgram.programId),
    ).length,
  ).toBe(0);
});

test("five assets partition to two ordered transactions with the tip only on the final swap", () => {
  const options = fixture(5, 14);
  const chunks = composeBasketV0Chunks(options);
  expect(chunks.length).toBe(2);
  expect(chunks.flatMap((chunk) => chunk.allocationIndexes)).toEqual([
    0, 1, 2, 3, 4,
  ]);
  for (const [index, chunk] of chunks.entries()) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(chunk.transaction, "base64"),
    );
    const message = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: options.lookupTables,
    });
    const tips = message.instructions.filter((ix) =>
      ix.programId.equals(SystemProgram.programId),
    );
    expect(tips.length).toBe(index === 1 ? 1 : 0);
    if (tips.length) {
      expect(
        message.instructions.at(-1)!.keys[1]!.pubkey.equals(tipAccount),
      ).toBeTruthy();
      expect(tips[0]!.data.readBigUInt64LE(4)).toBe(10000n);
      expect(
        tx.message.staticAccountKeys.some((address) =>
          address.equals(tipAccount),
        ),
      ).toBeTruthy();
    }
  }
});

test("ALTs compress wire bytes but five 24-account routes still require three chunks", () => {
  const options = fixture(5, 24);
  const chunks = composeBasketV0Chunks(options);
  expect(chunks.length).toBe(3);
  expect(
    chunks.every(
      (chunk) => chunk.accountCount <= 64 && chunk.serializedBytes <= 1232,
    ),
  ).toBeTruthy();
  expect(() =>
    composeV0Transaction({
      ...options,
      instructions: options.legs.flatMap((leg) => leg.instructions),
    }),
  ).toThrow(/64-account/);
});

test("capacity failure never emits a truncated basket and a split requires a reviewed tip", () => {
  expect(() => composeBasketV0Chunks(fixture(11, 24))).toThrow(
    /cannot fit within five/,
  );
  const simple = fixture(2, 1, 800);
  expect(() =>
    composeBasketV0Chunks({ ...simple, finalTipInstruction: undefined }),
  ).toThrow(/1232-byte/);
  expect(composeBasketV0Chunks(simple).length).toBe(2);
});

test("tip cannot be loaded from an ALT, and an extra route signer fails closed", () => {
  const options = fixture(5, 14);
  options.lookupTables[0]!.state.addresses.push(tipAccount);
  expect(() => composeBasketV0Chunks(options)).toThrow(
    /tip accounts must remain static/,
  );
  const other = fixture(1);
  other.legs[0]!.instructions[0]!.keys.push({
    pubkey: key(8),
    isSigner: true,
    isWritable: false,
  });
  expect(() => composeBasketV0Chunks(other)).toThrow(/additional signer/);
});

test("twelve fitting allocations stay single; nine account-heavy legs may use all five chunks", () => {
  expect(composeBasketV0Chunks(fixture(12)).length).toBe(1);
  const five = composeBasketV0Chunks(fixture(9, 24));
  expect(five.length).toBe(5);
  expect(five.flatMap((chunk) => chunk.allocationIndexes)).toEqual(
    Array.from({ length: 9 }, (_, i) => i),
  );
});
