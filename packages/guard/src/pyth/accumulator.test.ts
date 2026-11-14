import { describe, expect, test } from "vitest";
import {
  encodeAccumulatorUpdate,
  encodeMerkleRootPayload,
  encodePriceFeedMessage,
  encodeVaa,
  encodeVaaBody,
  parseAccumulatorUpdate,
  parseMerkleRootPayload,
  parsePriceFeedMessage,
  parseVaa,
} from "./accumulator";
import {
  concatBytes,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
  ByteWriter,
} from "./bytes";
import { sampleFeed, sampleUpdate } from "./test/fixtures";

describe("Pyth accumulator wire format", () => {
  test("a price feed message is 85 bytes and round-trips (negative price included)", () => {
    const feed = { ...sampleFeed(0xab), price: -5n };
    const bytes = encodePriceFeedMessage(feed);
    expect(bytes.length).toBe(85);
    expect(parsePriceFeedMessage(bytes)).toEqual(feed);
  });

  test("an accumulator update round-trips its VAA, messages and proofs", () => {
    const feeds = [sampleFeed(1), sampleFeed(2, 100n), sampleFeed(3)];
    const data = sampleUpdate(feeds, 13, 12);
    const parsed = parseAccumulatorUpdate(data);
    expect(parsed.updates.map((u) => u.feed)).toEqual(feeds);
    expect(parsed.updates[0]!.proof).toHaveLength(12);
    const vaa = parseVaa(parsed.vaa);
    expect(vaa.guardianSetIndex).toBe(4);
    expect(vaa.signatures).toHaveLength(13);
    expect(vaa.signatures[12]!.guardianIndex).toBe(12);
    expect(vaa.emitterChain).toBe(26);
    expect(vaa.sequence).toBe(99n);
    expect(toHex(vaa.emitterAddress)).toBe("e1".repeat(32));
    const root = parseMerkleRootPayload(vaa.payload);
    expect(root).toEqual({
      slot: 5n,
      ringSize: 10_000,
      root: new Uint8Array(20).fill(3),
    });
    expect(parsed.vaa.length).toBe(6 + 13 * 66 + 51 + 37);
  });

  test("malformed input is refused with a clear error", () => {
    const good = sampleUpdate([sampleFeed(1)]);
    expect(() => parseAccumulatorUpdate(good.slice(0, 20))).toThrow(
      /truncated/,
    );
    expect(() =>
      parseAccumulatorUpdate(concatBytes([good, Uint8Array.of(0)])),
    ).toThrow(/trailing/);
    const magic = good.slice();
    magic[0] = 0;
    expect(() => parseAccumulatorUpdate(magic)).toThrow(/magic/);
    const major = good.slice();
    major[4] = 2;
    expect(() => parseAccumulatorUpdate(major)).toThrow(/major version 2/);
    const proof = good.slice();
    proof[7] = 1;
    expect(() => parseAccumulatorUpdate(proof)).toThrow(/proof type 1/);
    const empty = encodeAccumulatorUpdate({
      vaa: Uint8Array.of(1),
      updates: [],
    });
    expect(() => parseAccumulatorUpdate(empty)).toThrow(/no price/);
    const twap = encodePriceFeedMessage(sampleFeed(1));
    twap[0] = 1;
    expect(() => parsePriceFeedMessage(twap)).toThrow(/message type 1/);
    expect(() => parseVaa(Uint8Array.of(2))).toThrow(/VAA version 2/);
    expect(() => parseMerkleRootPayload(new Uint8Array(37))).toThrow(/magic/);
    const payload = encodeMerkleRootPayload({
      slot: 1n,
      ringSize: 1,
      root: new Uint8Array(20),
    });
    payload[4] = 9;
    expect(() => parseMerkleRootPayload(payload)).toThrow(/payload type 9/);
  });

  test("encoders refuse wrong sizes", () => {
    expect(() =>
      encodePriceFeedMessage({ ...sampleFeed(1), feedId: "0x12" }),
    ).toThrow();
    expect(() =>
      encodeAccumulatorUpdate({
        vaa: Uint8Array.of(1),
        updates: [{ message: Uint8Array.of(0), proof: [new Uint8Array(3)] }],
      }),
    ).toThrow(/20 bytes/);
    expect(() =>
      encodeVaa({
        guardianSetIndex: 0,
        signatures: [{ guardianIndex: 0, signature: new Uint8Array(64) }],
        body: new Uint8Array(),
      }),
    ).toThrow(/65/);
    expect(() =>
      encodeVaaBody({
        timestamp: 0,
        nonce: 0,
        emitterChain: 1,
        emitterAddress: new Uint8Array(31),
        sequence: 0n,
        consistencyLevel: 0,
        payload: new Uint8Array(),
      }),
    ).toThrow(/32 bytes/);
    expect(() =>
      encodeMerkleRootPayload({
        slot: 0n,
        ringSize: 0,
        root: new Uint8Array(19),
      }),
    ).toThrow(/20 bytes/);
  });

  test("byte helpers", () => {
    expect(toHex(fromHex("0x00ff10"))).toBe("00ff10");
    expect(() => fromHex("abc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
    expect(fromBase64(toBase64(Uint8Array.of(1, 2, 250)))).toEqual(
      Uint8Array.of(1, 2, 250),
    );
    expect(() => fromBase64("abc")).toThrow();
    expect(() => new ByteWriter().u8(256)).toThrow();
    expect(() => new ByteWriter().u16(-1)).toThrow();
  });
});
