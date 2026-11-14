import { expect, test } from "vitest";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { decompileTransactionMessage } from "@solana/kit";
import * as sdk from "./mainnet";
const key = () => Keypair.generate().publicKey.toBase58();

test("V1-only creation rejects missing capability and never splits orders", async () => {
  const payer = key(),
    blockhash = key();
  const instructions = [
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.alloc(1300),
    }),
  ];
  await await expect(
    sdk.composeMainnetTransaction({
      payer,
      blockhash,
      lastValidBlockHeight: 10,
      instructions,
      allowV1: false,
    }),
  ).rejects.toThrow(/V1 transactions require/);
  const v1 = await sdk.composeMainnetTransaction({
    payer,
    blockhash,
    lastValidBlockHeight: 10,
    instructions,
    allowV1: true,
  });
  expect(v1.transactionVersion).toBe(1);
  expect(v1.serializedBytes <= 4096).toBeTruthy();
  const decoded = await sdk.inspectWalletTransaction(v1.transaction);
  expect(decoded.message.version).toBe(1);
  expect(Object.keys(decoded.transaction.signatures)).toEqual([payer]);
});
test("V1 still refuses more than 64 accounts and additional signers", async () => {
  const payer = key(),
    blockhash = key();
  const ix = new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: Array.from({ length: 64 }, () => ({
      pubkey: new PublicKey(key()),
      isSigner: false,
      isWritable: true,
    })),
    data: Buffer.alloc(0),
  });
  await await expect(
    sdk.composeMainnetTransaction({
      payer,
      blockhash,
      lastValidBlockHeight: 1,
      instructions: [ix],
      allowV1: true,
    }),
  ).rejects.toThrow(/64-account/);
  ix.keys = [
    { pubkey: new PublicKey(key()), isSigner: true, isWritable: true },
  ];
  await await expect(
    sdk.composeMainnetTransaction({
      payer,
      blockhash,
      lastValidBlockHeight: 1,
      instructions: [ix],
      allowV1: true,
    }),
  ).rejects.toThrow(/signer/);
});
test("even compact orders use V1 with explicit resource budgets", async () => {
  const owner = Keypair.generate();
  const built = await sdk.composeMainnetTransaction({
    payer: owner.publicKey.toBase58(),
    blockhash: key(),
    lastValidBlockHeight: 1,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: new PublicKey(key()),
        lamports: 1,
      }),
    ],
    allowV1: true,
    computeUnitLimit: 100_000,
    loadedAccountsDataSizeLimit: 131072,
    priorityFeeLamports: 5000,
  });
  expect(built.transactionVersion).toBe(1);
  const { message } = await sdk.inspectWalletTransaction(built.transaction);
  expect(message.version).toBe(1);
  // kit 7's message types stop at v0 (M2 decision 1); read the v1 config field through a cast.
  const config = (
    decompileTransactionMessage(message) as unknown as {
      config: Record<string, unknown>;
    }
  ).config;
  expect(config.computeUnitLimit).toBe(100_000);
  expect(config.loadedAccountsDataSizeLimit).toBe(131072);
  expect(config.priorityFeeLamports).toBe(5000n);
  // kit 7's published message types stop at legacy/v0 (M2 decision 1), so read the field loosely.
  expect(
    (message as { addressTableLookups?: unknown }).addressTableLookups,
  ).toBe(undefined);
  await await expect(
    sdk.walletTransactionSignature(built.transaction),
  ).rejects.toThrow(/did not sign/);
});
test("old v0 transaction reading and explorer signatures remain supported", async () => {
  const owner = Keypair.generate();
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: key(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: new PublicKey(key()),
          lamports: 1,
        }),
      ],
    }).compileToV0Message(),
  );
  transaction.sign([owner]);
  const encoded = Buffer.from(transaction.serialize()).toString("base64");
  expect((await sdk.inspectWalletTransaction(encoded)).message.version).toBe(0);
  expect(await sdk.walletTransactionSignature(encoded)).toMatch(
    /^[1-9A-HJ-NP-Za-km-z]{80,90}$/,
  );
});
test("V1 rejects no-op compute instructions, oversized payloads and invalid limits", async () => {
  const params = {
    payer: key(),
    blockhash: key(),
    lastValidBlockHeight: 1,
    allowV1: true,
  };
  await await expect(
    sdk.composeMainnetTransaction({
      ...params,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })],
    }),
  ).rejects.toThrow(/message config/);
  await await expect(
    sdk.composeMainnetTransaction({
      ...params,
      instructions: [
        new TransactionInstruction({
          programId: SystemProgram.programId,
          keys: [],
          data: Buffer.alloc(4096),
        }),
      ],
    }),
  ).rejects.toThrow(/size limit/);
  for (const limits of [
    { computeUnitLimit: 0 },
    { computeUnitLimit: 1_400_001 },
    { loadedAccountsDataSizeLimit: 0 },
    { priorityFeeLamports: 100_001 },
  ])
    await await expect(
      sdk.composeMainnetTransaction({ ...params, ...limits, instructions: [] }),
    ).rejects.toThrow(/budget|fee limit/);
});
