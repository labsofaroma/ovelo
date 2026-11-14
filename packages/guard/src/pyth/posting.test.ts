import { describe, expect, test } from "vitest";
import { generateKeyPairSigner, type TransactionSigner } from "@solana/kit";
import {
  buildVerifiedPriceUpdates,
  computeBudgetInstructions,
  TRANSACTION_SIZE_LIMIT,
  transactionSize,
} from "./posting";
import { findGuardianSetPda, WORMHOLE_DISCRIMINATORS } from "./wormhole";
import { parseAccumulatorUpdate } from "./accumulator";
import { buildExecuteInstallmentInstruction } from "../v1";
import { sampleFeed, sampleUpdate } from "./test/fixtures";

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
      report.push(
        `${legs} leg(s), 12-node proofs: execute ${alone} B; + all posts ${withPosts} B; + 1 post ${onePost} B; posts alone ${postsOnly} B`,
      );
      if (legs === 1)
        expect(postsOnly).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
      expect(alone).toBeLessThanOrEqual(TRANSACTION_SIZE_LIMIT);
      if (legs > 1) expect(withPosts).toBeGreaterThan(TRANSACTION_SIZE_LIMIT);
    }
    // Longest proof for which one post still shares a transaction with a 1-leg execute.
    let longest = -1;
    for (let nodes = 0; nodes <= 12; nodes += 1) {
      const { payer, built } = await build(1, 1, nodes);
      const execute = await buildExecuteInstallmentInstruction({
        keeper: payer,
        planAddress: at(0),
        plan: {
          owner: at(1),
          fundingMint: at(2),
          fundingTokenProgram: at(3),
          subscriptionAuthority: at(4),
          recurringDelegation: at(5),
          outputs: [{ mint: at(6), weightBps: 10_000, maxSlippageBps: 0 }],
        },
        treasury: at(10),
        feeRecipient: null,
        period: 0,
        legMask: 1,
        legs: [
          {
            mint: at(6),
            tokenProgram: at(11),
            priceUpdate: built.priceUpdates[0]!.address,
          },
        ],
      });
      if (
        transactionSize(payer, [...COMPUTE, built.post[0]!, execute]) <=
        TRANSACTION_SIZE_LIMIT
      )
        longest = nodes;
    }
    report.push(
      `1 leg: one post fits beside execute up to ${longest} proof nodes`,
    );
    console.info(report.join("\n"));
  });

  test("keepPriceUpdates leaves the price update accounts for reuse", async () => {
    const [p, v, u] = await signers(3);
    const kept = await buildVerifiedPriceUpdates({
      payer: p!,
      writeAuthority: p!,
      accumulator: sampleUpdate([sampleFeed(1)]),
      encodedVaa: v!,
      encodedVaaLamports: 1n,
      priceUpdateSigners: [u!],
      keepPriceUpdates: true,
      treasuryId: 0,
    });
    expect(kept.cleanup).toHaveLength(1);
    expect(kept.priceUpdates[0]!.address).toBe(u!.address);
  });
});
