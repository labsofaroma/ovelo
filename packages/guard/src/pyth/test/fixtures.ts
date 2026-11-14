/** Synthetic wire data for unit tests (no keys: signatures are filler bytes, never verified here). */
import {
  encodeAccumulatorUpdate,
  encodeMerkleRootPayload,
  encodePriceFeedMessage,
  encodeVaa,
  encodeVaaBody,
  type PriceFeedMessage,
} from "../accumulator";

export const sampleFeed = (
  byte: number,
  price = 21_034_500n,
): PriceFeedMessage => ({
  feedId: `0x${byte.toString(16).padStart(2, "0").repeat(32)}`,
  price,
  conf: 12_345n,
  exponent: -5,
  publishTime: 1_800_000_000n,
  prevPublishTime: 1_799_999_999n,
  emaPrice: price - 1n,
  emaConf: 12_000n,
});

export function sampleUpdate(
  feeds: PriceFeedMessage[],
  signatures = 1,
  proofNodes = 2,
): Uint8Array {
  const body = encodeVaaBody({
    timestamp: 1_800_000_000,
    nonce: 7,
    emitterChain: 26,
    emitterAddress: new Uint8Array(32).fill(0xe1),
    sequence: 99n,
    consistencyLevel: 1,
    payload: encodeMerkleRootPayload({
      slot: 5n,
      ringSize: 10_000,
      root: new Uint8Array(20).fill(3),
    }),
  });
  const vaa = encodeVaa({
    guardianSetIndex: 4,
    signatures: Array.from({ length: signatures }, (_, i) => ({
      guardianIndex: i,
      signature: new Uint8Array(65).fill(i + 1),
    })),
    body,
  });
  return encodeAccumulatorUpdate({
    vaa,
    updates: feeds.map((f) => ({
      message: encodePriceFeedMessage(f),
      proof: Array.from({ length: proofNodes }, (_, k) =>
        new Uint8Array(20).fill(k + 9),
      ),
    })),
  });
}
