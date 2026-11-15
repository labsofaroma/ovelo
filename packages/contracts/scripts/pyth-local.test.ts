import { describe, expect, test } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { generateKeyPairSigner } from "@solana/kit";
import {
  concatBytes,
  findGuardianSetPda,
  findReceiverConfigPda,
  HermesError,
  HermesUpdatesClient,
  parseAccumulatorUpdate,
  parseMerkleRootPayload,
  parseVaa,
  PYTH_RECEIVER_ID,
  toHex,
  WORMHOLE_PROGRAM_ID,
} from "@ovelo/guard/pyth";
import {
  createTestGuardian,
  localPythAccounts,
  merkleTree,
  startFakeHermes,
  type DataSource,
} from "./lib/pyth-local";

const k160 = (...p: Uint8Array[]) => keccak_256(concatBytes(p)).subarray(0, 20);
function verifyPath(root: Uint8Array, leaf: Uint8Array, proof: Uint8Array[]) {
  let h = k160(Uint8Array.of(0), leaf);
  for (const node of proof) {
    const [a, b] =
      Buffer.compare(Buffer.from(h), Buffer.from(node)) <= 0
        ? [h, node]
        : [node, h];
    h = k160(Uint8Array.of(1), a, b);
  }
  return toHex(h) === toHex(root);
}

const FEED_A = `0x${"a1".repeat(32)}`;
const FEED_B = `0x${"b2".repeat(32)}`;

describe("local Pyth stand-ins", () => {
  test("every merkle proof verifies against the root, for 1 to 7 leaves", () => {
    for (let n = 1; n <= 7; n += 1) {
      const leaves = Array.from({ length: n }, (_, i) =>
        Uint8Array.of(i, i + 1),
      );
      const { root, proofs } = merkleTree(leaves);
      leaves.forEach((leaf, i) =>
        expect(verifyPath(root, leaf, proofs[i]!)).toBe(true),
      );
      expect(verifyPath(root, Uint8Array.of(99), proofs[0]!)).toBe(false);
    }
    expect(() => merkleTree([])).toThrow();
  });

  test("validator accounts: guardian set and receiver config at their PDAs", async () => {
    const guardian = createTestGuardian();
    const source: DataSource = {
      chain: 26,
      emitter: (await generateKeyPairSigner()).address,
    };
    const [set, config] = await localPythAccounts({
      guardians: [guardian],
      guardianSetIndex: 3,
      source,
      governance: source.emitter,
      creationTime: 1,
    });
    expect(set!.address).toBe(await findGuardianSetPda(3));
    expect(set!.owner).toBe(WORMHOLE_PROGRAM_ID);
    expect(config!.address).toBe(await findReceiverConfigPda());
    expect(config!.owner).toBe(PYTH_RECEIVER_ID);
    expect(config!.data.length).toBe(370);
    expect(JSON.parse(config!.json).account.owner).toBe(PYTH_RECEIVER_ID);
  });

  test("fake Hermes serves signed updates the guard client parses; unknown feeds are 404", async () => {
    const guardian = createTestGuardian();
    const source: DataSource = {
      chain: 26,
      emitter: (await generateKeyPairSigner()).address,
    };
    const hermes = await startFakeHermes({
      guardians: [guardian],
      guardianSetIndex: 1,
      source,
      prices: new Map([
        [FEED_A, { price: 30_181_002n, conf: 14_208n, expo: -5 }],
        [FEED_B, { price: 35_874_000n, conf: 6_000n, expo: -5 }],
      ]),
      now: () => 1_800_000_000,
    });
    try {
      const client = new HermesUpdatesClient(hermes.url);
      const out = await client.latestUpdates([FEED_A, FEED_B]);
      expect(out.feeds.map((f) => [f.id, f.price, f.publishTime])).toEqual([
        [FEED_A, 30_181_002n, 1_800_000_000n],
        [FEED_B, 35_874_000n, 1_800_000_000n],
      ]);
      const update = parseAccumulatorUpdate(out.updates[0]!);
      const vaa = parseVaa(update.vaa);
      expect(vaa.guardianSetIndex).toBe(1);
      expect(vaa.emitterChain).toBe(26);
      // The guardian's signature recovers to its address over keccak(keccak(body)).
      const digest = keccak_256(keccak_256(vaa.body));
      const sig = vaa.signatures[0]!.signature;
      const recovered = secp256k1.Signature.fromCompact(sig.subarray(0, 64))
        .addRecoveryBit(sig[64]!)
        .recoverPublicKey(digest)
        .toRawBytes(false)
        .subarray(1);
      expect(toHex(keccak_256(recovered).subarray(12))).toBe(
        toHex(guardian.ethAddress),
      );
      const root = parseMerkleRootPayload(vaa.payload).root;
      for (const u of update.updates)
        expect(verifyPath(root, u.message, u.proof)).toBe(true);
      await expect(
        client.latestUpdates([`0x${"cc".repeat(32)}`]),
      ).rejects.toBeInstanceOf(HermesError);
      const other = await fetch(`${hermes.url}/v2/other`);
      expect(other.status).toBe(404);
      expect(hermes.requests).toBe(3);
    } finally {
      await hermes.close();
    }
  });
});
