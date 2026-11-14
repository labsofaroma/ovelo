/**
 * Pyth accumulator updates as Hermes serves them (`binary.data`), the Wormhole v1 VAA inside
 * them, the "AUWV" merkle-root payload and price feed messages. Parsers and the matching
 * encoders (the encoders serve tests and the local stand-in for Hermes; they never hash).
 *
 * Formats follow pyth-network/pyth-crosschain (main, read 2026-11-14):
 * - `pythnet/pythnet_sdk/src/wire.rs` (AccumulatorUpdateData, Proof::WormholeMerkle,
 *   MerklePriceUpdate, WormholeMessage / WormholeMerkleRoot), big-endian, with
 *   `PrefixedVec<u16, u8>` for the VAA and each message and `u8` counts for updates and proofs;
 * - `pythnet/pythnet_sdk/src/messages.rs` (Message::PriceFeedMessage = variant 0);
 * - VAA v1 as parsed by `wormhole-raw-vaas` (version, guardian set index, signatures, body).
 */
import { ByteReader, ByteWriter, toHex } from "./bytes";

export const ACCUMULATOR_MAGIC = Uint8Array.of(0x50, 0x4e, 0x41, 0x55); // "PNAU"
export const WORMHOLE_MERKLE_MAGIC = Uint8Array.of(0x41, 0x55, 0x57, 0x56); // "AUWV"
const PROOF_WORMHOLE_MERKLE = 0;
const PAYLOAD_MERKLE = 0;
const MESSAGE_PRICE_FEED = 0;
export const MERKLE_NODE_BYTES = 20;
export const VAA_SIGNATURE_BYTES = 66;

export type PriceFeedMessage = {
  /** 32-byte feed id, lowercase hex with 0x. */
  feedId: string;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  prevPublishTime: bigint;
  emaPrice: bigint;
  emaConf: bigint;
};

export type MerkleUpdate = {
  message: Uint8Array;
  proof: Uint8Array[];
  feed: PriceFeedMessage;
};

export type AccumulatorUpdate = { vaa: Uint8Array; updates: MerkleUpdate[] };

export type VaaSignature = {
  guardianIndex: number;
  /** r (32) ‖ s (32) ‖ recovery id (1). */
  signature: Uint8Array;
};

export type ParsedVaa = {
  version: number;
  guardianSetIndex: number;
  signatures: VaaSignature[];
  /** The signed body; the guardians sign keccak256(keccak256(body)). */
  body: Uint8Array;
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Uint8Array;
  sequence: bigint;
  consistencyLevel: number;
  payload: Uint8Array;
};

export type MerkleRootPayload = {
  slot: bigint;
  ringSize: number;
  root: Uint8Array;
};

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function parsePriceFeedMessage(message: Uint8Array): PriceFeedMessage {
  const r = new ByteReader(message, "Price feed message");
  const kind = r.u8();
  if (kind !== MESSAGE_PRICE_FEED)
    throw new Error(`Unsupported Pyth message type ${kind}.`);
  const feed: PriceFeedMessage = {
    feedId: `0x${toHex(r.take(32))}`,
    price: r.i64(),
    conf: r.u64(),
    exponent: r.i32(),
    publishTime: r.i64(),
    prevPublishTime: r.i64(),
    emaPrice: r.i64(),
    emaConf: r.u64(),
  };
  r.end();
  return feed;
}

export function encodePriceFeedMessage(feed: PriceFeedMessage): Uint8Array {
  const id = feed.feedId.replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("Feed id must be 32 bytes.");
  const w = new ByteWriter().u8(MESSAGE_PRICE_FEED);
  for (let i = 0; i < 64; i += 2) w.u8(parseInt(id.slice(i, i + 2), 16));
  return w
    .i64(feed.price)
    .u64(feed.conf)
    .i32(feed.exponent)
    .i64(feed.publishTime)
    .i64(feed.prevPublishTime)
    .i64(feed.emaPrice)
    .u64(feed.emaConf)
    .toBytes();
}

export function parseAccumulatorUpdate(data: Uint8Array): AccumulatorUpdate {
  const r = new ByteReader(data, "Accumulator update");
  if (!same(r.take(4), ACCUMULATOR_MAGIC))
    throw new Error("Not a Pyth accumulator update (magic).");
  const major = r.u8();
  r.u8(); // minor: newer minor versions stay compatible (wire.rs)
  if (major !== 1)
    throw new Error(`Unsupported accumulator major version ${major}.`);
  r.take(r.u8()); // trailing header
  const proofType = r.u8();
  if (proofType !== PROOF_WORMHOLE_MERKLE)
    throw new Error(`Unsupported accumulator proof type ${proofType}.`);
  const vaa = r.take(r.u16());
  const count = r.u8();
  const updates: MerkleUpdate[] = [];
  for (let i = 0; i < count; i += 1) {
    const message = r.take(r.u16());
    const proofLength = r.u8();
    const proof: Uint8Array[] = [];
    for (let k = 0; k < proofLength; k += 1)
      proof.push(r.take(MERKLE_NODE_BYTES));
    updates.push({ message, proof, feed: parsePriceFeedMessage(message) });
  }
  r.end();
  if (updates.length === 0)
    throw new Error("Accumulator update carries no price.");
  return { vaa, updates };
}

export function encodeAccumulatorUpdate(input: {
  vaa: Uint8Array;
  updates: { message: Uint8Array; proof: Uint8Array[] }[];
}): Uint8Array {
  const w = new ByteWriter()
    .bytes(ACCUMULATOR_MAGIC)
    .u8(1)
    .u8(0)
    .u8(0)
    .u8(PROOF_WORMHOLE_MERKLE)
    .u16(input.vaa.length)
    .bytes(input.vaa)
    .u8(input.updates.length);
  for (const update of input.updates) {
    w.u16(update.message.length).bytes(update.message).u8(update.proof.length);
    for (const node of update.proof) {
      if (node.length !== MERKLE_NODE_BYTES)
        throw new Error("Merkle nodes are 20 bytes.");
      w.bytes(node);
    }
  }
  return w.toBytes();
}

export function parseVaa(vaa: Uint8Array): ParsedVaa {
  const r = new ByteReader(vaa, "VAA");
  const version = r.u8();
  if (version !== 1) throw new Error(`Unsupported VAA version ${version}.`);
  const guardianSetIndex = r.u32();
  const count = r.u8();
  const signatures: VaaSignature[] = [];
  for (let i = 0; i < count; i += 1)
    signatures.push({ guardianIndex: r.u8(), signature: r.take(65) });
  const body = vaa.slice(r.position);
  const b = new ByteReader(body, "VAA body");
  const parsed: ParsedVaa = {
    version,
    guardianSetIndex,
    signatures,
    body,
    timestamp: b.u32(),
    nonce: b.u32(),
    emitterChain: b.u16(),
    emitterAddress: b.take(32),
    sequence: b.u64(),
    consistencyLevel: b.u8(),
    payload: b.rest(),
  };
  return parsed;
}

export function encodeVaaBody(body: {
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: Uint8Array;
  sequence: bigint;
  consistencyLevel: number;
  payload: Uint8Array;
}): Uint8Array {
  if (body.emitterAddress.length !== 32)
    throw new Error("Emitter address must be 32 bytes.");
  return new ByteWriter()
    .u32(body.timestamp)
    .u32(body.nonce)
    .u16(body.emitterChain)
    .bytes(body.emitterAddress)
    .u64(body.sequence)
    .u8(body.consistencyLevel)
    .bytes(body.payload)
    .toBytes();
}

/** A v1 VAA from its body and signatures (sorted by guardian index, as Wormhole requires). */
export function encodeVaa(input: {
  guardianSetIndex: number;
  signatures: VaaSignature[];
  body: Uint8Array;
}): Uint8Array {
  const w = new ByteWriter()
    .u8(1)
    .u32(input.guardianSetIndex)
    .u8(input.signatures.length);
  for (const sig of input.signatures) {
    if (sig.signature.length !== 65)
      throw new Error("A guardian signature is 65 bytes.");
    w.u8(sig.guardianIndex).bytes(sig.signature);
  }
  return w.bytes(input.body).toBytes();
}

export function parseMerkleRootPayload(payload: Uint8Array): MerkleRootPayload {
  const r = new ByteReader(payload, "Wormhole merkle payload");
  if (!same(r.take(4), WORMHOLE_MERKLE_MAGIC))
    throw new Error("Not a Pyth merkle-root payload (magic).");
  const kind = r.u8();
  if (kind !== PAYLOAD_MERKLE)
    throw new Error(`Unsupported Wormhole payload type ${kind}.`);
  const root = { slot: r.u64(), ringSize: r.u32(), root: r.take(20) };
  return root;
}

export function encodeMerkleRootPayload(root: MerkleRootPayload): Uint8Array {
  if (root.root.length !== MERKLE_NODE_BYTES)
    throw new Error("A merkle root is 20 bytes.");
  return new ByteWriter()
    .bytes(WORMHOLE_MERKLE_MAGIC)
    .u8(PAYLOAD_MERKLE)
    .u64(root.slot)
    .u32(root.ringSize)
    .bytes(root.root)
    .toBytes();
}
