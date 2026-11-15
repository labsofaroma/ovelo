/** Test-only Hermes: one well-formed accumulator for the requested feeds (no real signatures). */
import {
  encodeAccumulatorUpdate,
  encodeMerkleRootPayload,
  encodePriceFeedMessage,
  encodeVaa,
  encodeVaaBody,
  type HermesLatestUpdates,
} from "@ovelo/guard/pyth";

/** A fake Hermes answering with one accumulator for the requested feeds at `publishTime`. */
export function fakeHermes(publishTime: () => bigint, failure?: Error) {
  const requests: string[][] = [];
  return {
    requests,
    async latestUpdates(ids: readonly string[]): Promise<HermesLatestUpdates> {
      requests.push([...ids]);
      if (failure) throw failure;
      const feeds = ids.map((id) => ({
        id,
        price: 23_142_000_000n,
        conf: 1_000_000n,
        expo: -8,
        publishTime: publishTime(),
      }));
      const body = encodeVaaBody({
        timestamp: Number(publishTime()),
        nonce: 1,
        emitterChain: 26,
        emitterAddress: new Uint8Array(32).fill(0xe1),
        sequence: 1n,
        consistencyLevel: 1,
        payload: encodeMerkleRootPayload({
          slot: 1n,
          ringSize: 10_000,
          root: new Uint8Array(20).fill(3),
        }),
      });
      const vaa = encodeVaa({
        guardianSetIndex: 4,
        signatures: [
          { guardianIndex: 0, signature: new Uint8Array(65).fill(1) },
        ],
        body,
      });
      const updates = [
        encodeAccumulatorUpdate({
          vaa,
          updates: feeds.map((f) => ({
            message: encodePriceFeedMessage({
              feedId: f.id,
              price: f.price,
              conf: f.conf,
              exponent: f.expo,
              publishTime: f.publishTime,
              prevPublishTime: f.publishTime - 1n,
              emaPrice: f.price,
              emaConf: f.conf,
            }),
            proof: [new Uint8Array(20).fill(7)],
          })),
        }),
      ];
      return { updates, feeds, fetchedAt: Date.now() };
    },
  };
}
