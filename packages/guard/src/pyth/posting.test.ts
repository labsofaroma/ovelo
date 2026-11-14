import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  AccountRole,
  generateKeyPairSigner,
  getAddressDecoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  buildVerifiedPriceUpdates,
  computeBudgetInstructions,
  TRANSACTION_SIZE_LIMIT,
  transactionSize,
} from "./posting";
import {
  closeEncodedVaaInstruction,
  encodedVaaSpace,
  encodeGuardianSet,
  ENCODED_VAA_DISCRIMINATOR,
  findGuardianSetPda,
  GUARDIAN_SET_DISCRIMINATOR,
  WORMHOLE_DISCRIMINATORS,
  WORMHOLE_PROGRAM_ID,
  writeEncodedVaaInstruction,
} from "./wormhole";
import {
  decodeReceiverConfig,
  encodePostUpdateParams,
  encodeReceiverConfig,
  findReceiverConfigPda,
  findReceiverTreasuryPda,
  PRICE_UPDATE_V2_DISCRIMINATOR,
  RECEIVER_CONFIG_DISCRIMINATOR,
  RECEIVER_DISCRIMINATORS,
} from "./receiver";
import { parseAccumulatorUpdate } from "./accumulator";
import { buildExecuteInstallmentInstruction } from "../v1";
import { sampleFeed, sampleUpdate } from "./test/fixtures";

const anchor = (name: string) =>
  Uint8Array.from(createHash("sha256").update(name).digest().subarray(0, 8));
const signers = (n: number) =>
  Promise.all(Array.from({ length: n }, () => generateKeyPairSigner()));
const COMPUTE = computeBudgetInstructions(1_400_000, 1n);

async function build(signatures: number, feeds: number, proofNodes = 12) {
  const [payer, vaa, ...updates] = await signers(2 + feeds);
  const data = sampleUpdate(
    Array.from({ length: feeds }, (_, i) => sampleFeed(0x10 + i)),
    signatures,
    proofNodes,
  );
  const built = await buildVerifiedPriceUpdates({
    payer: payer!,
    writeAuthority: payer!,
    accumulator: data,
    encodedVaa: vaa!,
    encodedVaaLamports: 10_000_000n,
    priceUpdateSigners: updates,
    treasuryId: 0,
  });
  return { payer: payer!, built, data };
}

describe("Wormhole and receiver instruction layouts", () => {
  test("discriminators are sha256 of the Anchor names", () => {
    expect(WORMHOLE_DISCRIMINATORS.initEncodedVaa).toEqual(
      anchor("global:init_encoded_vaa"),
    );
    expect(WORMHOLE_DISCRIMINATORS.writeEncodedVaa).toEqual(
      anchor("global:write_encoded_vaa"),
    );
    expect(WORMHOLE_DISCRIMINATORS.verifyEncodedVaaV1).toEqual(
      anchor("global:verify_encoded_vaa_v1"),
    );
    expect(WORMHOLE_DISCRIMINATORS.closeEncodedVaa).toEqual(
      anchor("global:close_encoded_vaa"),
    );
    expect(RECEIVER_DISCRIMINATORS.postUpdate).toEqual(
      anchor("global:post_update"),
    );
    expect(RECEIVER_DISCRIMINATORS.reclaimRent).toEqual(
      anchor("global:reclaim_rent"),
    );
    expect(ENCODED_VAA_DISCRIMINATOR).toEqual(anchor("account:EncodedVaa"));
    expect(GUARDIAN_SET_DISCRIMINATOR).toEqual(anchor("account:GuardianSet"));
    expect(RECEIVER_CONFIG_DISCRIMINATOR).toEqual(anchor("account:Config"));
    expect(PRICE_UPDATE_V2_DISCRIMINATOR).toEqual(
      anchor("account:PriceUpdateV2"),
    );
  });

  test("write and post data are Borsh (u32 LE lengths)", async () => {
    const [a] = await signers(1);
    const ix = writeEncodedVaaInstruction({
      writeAuthority: a!,
      encodedVaa: a!.address,
      index: 300,
      data: Uint8Array.of(7, 8),
    });
    expect([...ix.data!]).toEqual([
      ...WORMHOLE_DISCRIMINATORS.writeEncodedVaa,
      44,
      1,
      0,
      0,
      2,
      0,
      0,
      0,
      7,
      8,
    ]);
    expect(() =>
      writeEncodedVaaInstruction({
        writeAuthority: a!,
        encodedVaa: a!.address,
        index: 0,
        data: new Uint8Array(),
      }),
    ).toThrow();
    const post = encodePostUpdateParams({
      message: Uint8Array.of(1, 2, 3),
      proof: [new Uint8Array(20).fill(5)],
      treasuryId: 3,
    });
    expect([...post.subarray(8)]).toEqual([
      3,
      0,
      0,
      0,
      1,
      2,
      3,
      1,
      0,
      0,
      0,
      ...new Array(20).fill(5),
      3,
    ]);
    expect(() =>
      encodePostUpdateParams({
        message: Uint8Array.of(1),
        proof: [new Uint8Array(19)],
        treasuryId: 0,
      }),
    ).toThrow();
    expect(() =>
      encodePostUpdateParams({
        message: Uint8Array.of(1),
        proof: [],
        treasuryId: 256,
      }),
    ).toThrow();
    const close = closeEncodedVaaInstruction({
      writeAuthority: a!,
      encodedVaa: a!.address,
    });
    expect(close.accounts![0]!.role).toBe(AccountRole.WRITABLE_SIGNER);
    expect(encodedVaaSpace(100)).toBe(146);
    expect(() => encodedVaaSpace(0)).toThrow();
  });

  test("PDAs: guardian set index is big-endian; config and treasury seeds", async () => {
    // Devnet's real guardian set 1 and receiver config / treasury 0 (read-only, 2026-11-14).
    expect(await findGuardianSetPda(1)).toBe(
      "8d9szTd157GKCLcxBqiLUgB7mek3v65rbsy2ErRyjwQ5",
    );
    expect(await findReceiverConfigPda()).toBe(
      "DaWUKXCyXsnzcvLUyeJRWou8KTn7XtadgTsdhJ6RHS7b",
    );
    expect(await findReceiverTreasuryPda(0)).toBe(
      "8hQfT7SVhkCrzUSgBq6u2wYEt1sH3xmofZ5ss3YaydZW",
    );
    await expect(findReceiverTreasuryPda(256)).rejects.toThrow();
  });

  test("receiver config and guardian set encoders round-trip / have the upstream size", async () => {
    const [g, t] = await signers(2);
    const config = {
      governanceAuthority: g!.address,
      targetGovernanceAuthority: t!.address,
      wormhole: WORMHOLE_PROGRAM_ID,
      validDataSources: [
        {
          chain: 26,
          emitter: getAddressDecoder().decode(
            new Uint8Array(32).fill(0xe1),
          ) as Address,
        },
      ],
      singleUpdateFeeLamports: 1n,
      minimumSignatures: 5,
    };
    expect(decodeReceiverConfig(encodeReceiverConfig(config))).toEqual(config);
    const none = { ...config, targetGovernanceAuthority: null };
    expect(decodeReceiverConfig(encodeReceiverConfig(none))).toEqual(none);
    expect(() => decodeReceiverConfig(new Uint8Array(40))).toThrow(
      /receiver config/,
    );
    expect(() =>
      decodeReceiverConfig(RECEIVER_CONFIG_DISCRIMINATOR.slice()),
    ).toThrow(/truncated/);
    // Same size as devnet's guardian set 1 (5 keys, 124 bytes).
    const set = encodeGuardianSet({
      index: 1,
      keys: Array.from({ length: 5 }, () => new Uint8Array(20)),
      creationTime: 1,
      expirationTime: 0,
    });
    expect(set.length).toBe(124);
    expect(() =>
      encodeGuardianSet({
        index: 1,
        keys: [new Uint8Array(19)],
        creationTime: 0,
        expirationTime: 0,
      }),
    ).toThrow();
  });
});

describe("verified price update packing", () => {
  const sizes = (payer: TransactionSigner, groups: { prepare: unknown[][] }) =>
    (groups.prepare as Parameters<typeof transactionSize>[1][]).map((g) =>
      transactionSize(payer, [...COMPUTE, ...g]),
    );

  test.each([
    [1, 1],
    [13, 2],
    [19, 2],
  ])(
    "a VAA with %i signatures verifies in %i prepare transaction(s), each within 1,232 bytes",
    async (sigs, txs) => {
      const { payer, built } = await build(sigs, 3);
      expect(built.prepare).toHaveLength(txs);
      for (const size of sizes(payer, built))
        expect(size).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
      const last = built.prepare.at(-1)!.at(-1)!;
      expect(last.data!.subarray(0, 8)).toEqual(
        WORMHOLE_DISCRIMINATORS.verifyEncodedVaaV1,
      );
      expect(last.accounts![2]!.address).toBe(await findGuardianSetPda(4));
      // Writes cover the VAA exactly once, in order.
      const parsed = parseAccumulatorUpdate((await build(sigs, 3)).data);
      const written = built.prepare
        .flat()
        .filter(
          (ix) => ix.data![0] === WORMHOLE_DISCRIMINATORS.writeEncodedVaa[0],
        )
        .reduce((n, ix) => n + ix.data!.length - 16, 0);
      expect(written).toBe(parsed.vaa.length);
    },
  );

  test("a chunk cap splits the writes further", async () => {
    const [payer, vaa, u] = await signers(3);
    const built = await buildVerifiedPriceUpdates({
      payer: payer!,
      writeAuthority: payer!,
      accumulator: parseAccumulatorUpdate(sampleUpdate([sampleFeed(1)], 19)),
      encodedVaa: vaa!,
      encodedVaaLamports: 1n,
      priceUpdateSigners: [u!],
      treasuryId: 0,
      chunkBytes: 300,
    });
    const writes = built.prepare
      .flat()
      .filter(
        (ix) => ix.data![0] === WORMHOLE_DISCRIMINATORS.writeEncodedVaa[0],
      );
    expect(writes.length).toBeGreaterThanOrEqual(5);
  });

  test("post, cleanup and the price update addresses follow the feeds", async () => {
    const { built } = await build(1, 2);
    expect(built.post).toHaveLength(2);
    expect(built.cleanup).toHaveLength(3);
    expect(built.priceUpdates.map((p) => p.feedId)).toEqual([
      sampleFeed(0x10).feedId,
      sampleFeed(0x11).feedId,
    ]);
    expect(built.post[0]!.accounts![4]!.address).toBe(
      built.priceUpdates[0]!.address,
    );
    expect(built.guardianSetIndex).toBe(4);
    const [p, v] = await signers(2);
    await expect(
      buildVerifiedPriceUpdates({
        payer: p!,
        writeAuthority: p!,
        accumulator: sampleUpdate([sampleFeed(1)]),
        encodedVaa: v!,
        encodedVaaLamports: 1n,
        priceUpdateSigners: [],
        treasuryId: 0,
      }),
    ).rejects.toThrow(/One price update signer/);
  });

  test("how many post_update instructions fit next to execute_installment (no lookup table)", async () => {
    const accounts = await signers(12);
    const at = (i: number) => accounts[i]!.address;
    const report: string[] = [];
    for (const legs of [1, 2, 3]) {
      const { payer, built } = await build(19, legs, 12);
      const execute = await buildExecuteInstallmentInstruction({
        keeper: payer,
        planAddress: at(0),
        plan: {
          owner: at(1),
          fundingMint: at(2),
          fundingTokenProgram: at(3),
          subscriptionAuthority: at(4),
          recurringDelegation: at(5),
          outputs: Array.from({ length: legs }, (_, i) => ({
            mint: at(6 + i),
            weightBps: 1,
            maxSlippageBps: 0,
          })),
        },
        treasury: at(10),
        feeRecipient: null,
        period: 0,
        legMask: (1 << legs) - 1,
        legs: built.priceUpdates.map((p, i) => ({
          mint: at(6 + i),
          tokenProgram: at(11),
          priceUpdate: p.address,
        })),
      });
      const alone = transactionSize(payer, [...COMPUTE, execute]);
      const withPosts = transactionSize(payer, [
        ...COMPUTE,
        ...built.post,
        execute,
      ]);
      const onePost = transactionSize(payer, [
        ...COMPUTE,
        built.post[0]!,
        execute,
      ]);
      const postsOnly = transactionSize(payer, [...COMPUTE, ...built.post]);
      // Persistent price update accounts (already owned by the keeper): no extra signatures.
      const persistent = await buildVerifiedPriceUpdates({
        payer,
        writeAuthority: payer,
        accumulator: (await build(19, legs, 12)).data,
        encodedVaa: payer,
        encodedVaaLamports: 1n,
        priceUpdateSigners: accounts.slice(0, legs).map((a) => a.address),
        treasuryId: 0,
      });
      const persistentPosts = transactionSize(payer, [
        ...COMPUTE,
        ...persistent.post,
      ]);
      const persistentWithExecute = transactionSize(payer, [
        ...COMPUTE,
        persistent.post[0]!,
        execute,
      ]);
      report.push(
        `${legs} leg(s): execute ${alone} B | fresh accounts: +all posts ${withPosts} B, +1 post ${onePost} B, posts alone ${postsOnly} B | persistent accounts: posts alone ${persistentPosts} B, 1 post + execute ${persistentWithExecute} B`,
      );
      expect(persistent.cleanup).toHaveLength(1);
      if (legs === 1)
        expect(postsOnly).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
      expect(alone).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
      if (legs > 1) expect(withPosts).toBeGreaterThan(TRANSACTION_SIZE_LIMIT);
    }
    console.info(report.join("\n"));
  });
});
