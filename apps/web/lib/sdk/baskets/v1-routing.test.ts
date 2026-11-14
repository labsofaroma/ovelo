import { expect, test } from "vitest";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  composeBasketV1Chunks,
  composeV1Transaction,
  inspectWalletTransaction,
  countTransactionAccounts,
} from "./mainnet";
import { TransactionCapacityError } from "./transaction-limits";
import {
  calculateEqualWeights,
  autoBalanceWeights,
  validateProgrammableBasket,
} from "./custom";

const key = (seed: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(seed);
  return Keypair.fromSeed(bytes).publicKey;
};
const payer = key(1);
const tipAccount = key(2);
const program = key(3);
const tip = SystemProgram.transfer({
  fromPubkey: payer,
  toPubkey: tipAccount,
  lamports: 1000,
});
const fixture = (count: number, accountsPerLeg = 1, dataBytes = 20) => ({
  payer: payer.toBase58(),
  blockhash: key(4).toBase58(),
  lastValidBlockHeight: 100,
  allowV1: true,
  finalTipInstruction: tip,
  legs: Array.from({ length: count }, (_, index) => ({
    allocationIndex: index,
    instructions: [
      new TransactionInstruction({
        programId: program,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          ...Array.from({ length: accountsPerLeg }, (_, i) => ({
            pubkey: key(10 + index * accountsPerLeg + i),
            isSigner: false,
            isWritable: true,
          })),
        ],
        data: Buffer.alloc(dataBytes, index),
      }),
    ],
  })),
});

test("V1 fits twelve allocations as one static-account transaction without a tip", async () => {
  const chunks = await composeBasketV1Chunks(fixture(12));
  expect(chunks.length).toBe(1);
  const { message } = await inspectWalletTransaction(chunks[0]!.transaction);
  expect(message.version).toBe(1);
  expect("addressTableLookups" in message).toBe(false);
  expect(message.staticAccounts.includes(tipAccount.toBase58() as never)).toBe(
    false,
  );
  expect(chunks[0]!.accountCount).toBe(14);
  expect(chunks[0]!.allocationIndexes).toEqual(
    Array.from({ length: 12 }, (_, i) => i),
  );
});

test("V1 partitions when accounts exceed 64 and keeps the tip last without ALTs", async () => {
  const options = fixture(2, 32);
  expect(
    countTransactionAccounts(
      options.payer,
      options.legs.flatMap((leg) => leg.instructions),
    ),
  ).toBe(66);
  const chunks = await composeBasketV1Chunks(options);
  expect(chunks.length).toBe(2);
  const kit = await import("@solana/kit");
  for (const [index, chunk] of chunks.entries()) {
    expect(
      chunk.accountCount <= 64 && chunk.serializedBytes <= 4096,
    ).toBeTruthy();
    const { message } = await inspectWalletTransaction(chunk.transaction);
    expect("addressTableLookups" in message).toBe(false);
    const instructions = kit.decompileTransactionMessage(message).instructions;
    const tips = instructions.filter(
      (ix) => ix.programAddress === SystemProgram.programId.toBase58(),
    );
    expect(tips.length).toBe(index === chunks.length - 1 ? 1 : 0);
    if (tips.length) {
      expect(instructions.at(-1)!.accounts![1]!.address).toBe(
        tipAccount.toBase58(),
      );
      expect(Buffer.from(instructions.at(-1)!.data!).readBigUInt64LE(4)).toBe(
        1000n,
      );
    }
  }
});

test("low account count alone is insufficient: byte-heavy routes split and five chunks is a hard ceiling", async () => {
  const options = fixture(9, 1, 1600);
  const chunks = await composeBasketV1Chunks(options);
  expect(chunks.length).toBe(5);
  expect(chunks.flatMap((chunk) => chunk.allocationIndexes)).toEqual(
    Array.from({ length: 9 }, (_, i) => i),
  );
  expect(chunks.every((chunk) => chunk.serializedBytes <= 4096)).toBeTruthy();
  await expect(composeBasketV1Chunks(fixture(6, 1, 2500))).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof TransactionCapacityError && error.limit === "bundle",
  );
  await expect(
    composeBasketV1Chunks({ ...options, finalTipInstruction: undefined }),
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof TransactionCapacityError && error.limit === "bytes",
  );
});

test("capability, route validation and invalid resource limits are never swallowed during partitioning", async () => {
  await await expect(
    composeBasketV1Chunks({ ...fixture(2), allowV1: false }),
  ).rejects.toThrow(/activated cluster/);
  await await expect(
    composeBasketV1Chunks({ ...fixture(2), priorityFeeLamports: 100001 }),
  ).rejects.toThrow(/priority fee/);
  const signer = fixture(2, 32);
  signer.legs[1]!.instructions[0]!.keys.push({
    pubkey: key(999),
    isSigner: true,
    isWritable: true,
  });
  await await expect(composeBasketV1Chunks(signer)).rejects.toThrow(
    /additional signer/,
  );
  await await expect(
    composeBasketV1Chunks({
      ...fixture(2, 32),
      finalTipInstruction: ComputeBudgetProgram.setComputeUnitLimit({
        units: 2,
      }),
    }),
  ).rejects.toThrow(/message config/);
  const empty = fixture(2);
  empty.legs[0]!.instructions = [];
  await await expect(composeBasketV1Chunks(empty)).rejects.toThrow(
    /execution legs/,
  );
  const options = fixture(1);
  await await expect(
    composeV1Transaction({
      ...options,
      instructions: options.legs[0]!.instructions,
      lookupTables: [
        new AddressLookupTableAccount({
          key: key(8),
          state: {
            deactivationSlot: 2n ** 64n - 1n,
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
            addresses: [key(9)],
          },
        }),
      ],
    }),
  ).rejects.toThrow(/cannot use lookup tables/);
});

test("custom baskets permit twelve assets with exact equal and automatic weight conservation", () => {
  const assets = Array.from({ length: 12 }, (_, i) => ({
    mint: key(i + 10).toBase58(),
    symbol: `A${i}`,
  }));
  const allocations = calculateEqualWeights(assets);
  const basket = validateProgrammableBasket({
    id: "custom-twelve",
    name: "Twelve assets",
    ticker: "TWELVE",
    allocations,
  });
  expect(basket.allocations.length).toBe(12);
  expect(allocations.reduce((sum, value) => sum + value.weightBps, 0)).toBe(
    10000,
  );
  const balanced = autoBalanceWeights(
    allocations.map((value, i) => ({ ...value, weightBps: 100 * (i + 1) })),
  );
  expect(balanced.reduce((sum, value) => sum + value.weightBps, 0)).toBe(10000);
  expect(balanced.every((value) => value.weightBps > 0)).toBeTruthy();
  expect(() =>
    validateProgrammableBasket({
      ...basket,
      allocations: [
        ...allocations,
        { mint: key(50).toBase58(), symbol: "EXTRA", weightBps: 1 },
      ],
    }),
  ).toThrow(/between 2 and 12/);
});
