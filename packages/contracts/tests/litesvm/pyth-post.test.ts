/**
 * The keeper's fully verified price path against the REAL pinned binaries: Wormhole core bridge
 * (encoded VAA create → init → write → verify_encoded_vaa_v1), Pyth receiver (post_update →
 * PriceUpdateV2 with VerificationLevel::Full) and Ovelo Guard v1 (execute_installment consuming
 * the freshly posted accounts), then cleanup (close_encoded_vaa, reclaim_rent).
 *
 * The guardian set and receiver config are written by the test and trust ONE secp256k1 test
 * guardian generated at runtime (devnet's real data source, Pythnet chain 26, is kept). Prices
 * are the recorded real devnet AAPL/TSLA values (tests/fixtures/pyth-devnet-price-updates.json).
 * Proven: our VAA, merkle and instruction encodings are accepted by the real programs, and
 * forged, mis-sourced or unverified updates are refused. Not proven: real guardian signatures
 * on a real Hermes update (needs a Hermes API key and devnet).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  generateKeyPairSigner,
  getAddressDecoder,
  type KeyPairSigner,
} from "@solana/kit";
import * as v1 from "@ovelo/guard";
import {
  buildVerifiedPriceUpdates,
  encodedVaaSpace,
  parseAccumulatorUpdate,
  PRICE_UPDATE_V2_DISCRIMINATOR,
  PYTH_RECEIVER_ID,
  toHex,
  WORMHOLE_PROGRAM_ID,
  type PriceFeedMessage,
} from "@ovelo/guard/pyth";
import {
  createTestGuardian,
  localPythAccounts,
  signedAccumulatorUpdate,
  type DataSource,
  type TestGuardian,
} from "../../scripts/lib/pyth-local";
import { PROGRAM_DIR } from "./harness";
import { cuLimit, errorCode, evenWeights, World } from "./world";

const root = path.resolve(import.meta.dirname, "../..");
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", name), "utf8"));
const pins = fixture("runtime-programs.json") as {
  programs: Record<string, { programId: string; sha256: string }>;
};
const receiverFixture = fixture("pyth-devnet-receiver.json") as {
  receiverConfig: { decoded: { validDataSources: DataSource[] } };
};
const DEVNET_SOURCE =
  receiverFixture.receiverConfig.decoded.validDataSources[0]!;

/** Recorded real devnet prices (price, conf, expo) read from the PriceUpdateV2 bytes. */
const RECORDED = (
  fixture("pyth-devnet-price-updates.json") as {
    priceUpdates: { dataBase64: string }[];
  }
).priceUpdates.map((p) => {
  const b = Buffer.from(p.dataBase64, "base64");
  const o = 8 + 32 + 1 + 32;
  return {
    price: b.readBigInt64LE(o),
    conf: b.readBigUInt64LE(o + 8),
    expo: b.readInt32LE(o + 16),
  };
});

function wormholeBinary(): Uint8Array {
  const bytes = fs.readFileSync(path.join(PROGRAM_DIR, "wormhole.so"));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== pins.programs.wormhole?.sha256)
    throw new Error("wormhole.so is not the pinned binary; run test:fixtures.");
  return bytes;
}

const GUARDIAN_SET_INDEX = 1;

async function setup(stocks: number, source: DataSource = DEVNET_SOURCE) {
  const w = await World.create({ stocks });
  w.env.svm.addProgram(WORMHOLE_PROGRAM_ID, wormholeBinary());
  const guardian = createTestGuardian();
  for (const account of await localPythAccounts({
    guardians: [guardian],
    guardianSetIndex: GUARDIAN_SET_INDEX,
    source,
    governance: w.admin.address,
    creationTime: Number(w.env.now) - 1000,
  }))
    w.env.put(account.address, account.owner, account.data);
  return { w, guardian };
}

function feedsFor(w: World, legs: number): PriceFeedMessage[] {
  return w.stocks.slice(0, legs).map((s, i) => {
    const p = RECORDED[i % RECORDED.length]!;
    return {
      feedId: `0x${toHex(s.feedId)}`,
      price: p.price,
      conf: p.conf,
      exponent: p.expo,
      publishTime: w.env.now,
      prevPublishTime: w.env.now - 1n,
      emaPrice: p.price,
      emaConf: p.conf,
    };
  });
}

async function prepareAndPost(
  w: World,
  update: Uint8Array,
  o: {
    skipVerify?: boolean;
    keeper?: KeyPairSigner;
    priceUpdateSigners?: KeyPairSigner[];
    keep?: boolean;
  } = {},
) {
  const keeper = o.keeper ?? w.keeper;
  const encodedVaa = await generateKeyPairSigner();
  const parsed = parseAccumulatorUpdate(update);
  const priceUpdateSigners: KeyPairSigner[] =
    o.priceUpdateSigners ??
    (await Promise.all(parsed.updates.map(() => generateKeyPairSigner())));
  const built = await buildVerifiedPriceUpdates({
    payer: keeper,
    writeAuthority: keeper,
    keepPriceUpdates: o.keep,
    accumulator: parsed,
    encodedVaa,
    encodedVaaLamports: BigInt(
      w.env.svm.minimumBalanceForRentExemption(
        BigInt(encodedVaaSpace(parsed.vaa.length)),
      ),
    ),
    priceUpdateSigners,
    treasuryId: 0,
  });
  const results: { step: string; ok: boolean; logs: string[] }[] = [];
  for (const [i, group] of built.prepare.entries()) {
    const ixs = o.skipVerify
      ? group.filter((ix) => ix.data?.[0] !== 103) // drop verify_encoded_vaa_v1
      : group;
    const r = await w.env.trySend(keeper, [cuLimit(1_400_000), ...ixs]);
    results.push({ step: `prepare ${i}`, ...r });
  }
  for (const [i, post] of built.post.entries()) {
    const r = await w.env.trySend(keeper, [cuLimit(400_000), post]);
    results.push({ step: `post ${i}`, ...r });
  }
  return { built, results, encodedVaa: encodedVaa.address };
}

const okAll = (results: { step: string; ok: boolean; logs: string[] }[]) => {
  for (const r of results)
    expect(r.ok, `${r.step}\n${r.logs.join("\n")}`).toBe(true);
};

describe("fully verified Pyth posting (real Wormhole + receiver + Ovelo Guard v1)", () => {
  test.each([1, 3])(
    "%i leg(s): verify the VAA, post Full updates, execute at the posted price, reclaim rent",
    async (legs) => {
      const { w, guardian } = await setup(legs);
      const weights = evenWeights(legs);
      const amount = 100_000_000n;
      const plan = await w.createPlan({ amount, weights });
      const feeds = feedsFor(w, legs);
      const update = signedAccumulatorUpdate({
        guardians: [guardian],
        guardianSetIndex: GUARDIAN_SET_INDEX,
        source: DEVNET_SOURCE,
        feeds,
        timestamp: Number(w.env.now),
        sequence: 1n,
      });
      const { built, results, encodedVaa } = await prepareAndPost(w, update);
      okAll(results);

      for (const [i, posted] of built.priceUpdates.entries()) {
        const data = w.env.data(posted.address)!;
        const info = w.env.svm.getAccount(posted.address);
        expect(info.exists && info.programAddress).toBe(PYTH_RECEIVER_ID);
        expect(data.subarray(0, 8)).toEqual(PRICE_UPDATE_V2_DISCRIMINATOR);
        expect(getAddressDecoder().decode(data.subarray(8, 40))).toBe(
          w.keeper.address,
        );
        expect(data[40]).toBe(1); // VerificationLevel::Full
        const view = Buffer.from(data);
        expect(toHex(data.subarray(41, 73))).toBe(feeds[i]!.feedId.slice(2));
        expect(view.readBigInt64LE(73)).toBe(feeds[i]!.price);
        expect(view.readBigInt64LE(93)).toBe(w.env.now);
      }

      const r = await w.execute(plan, 0, (1 << legs) - 1, {
        prices: built.priceUpdates.map((p) => p.address),
      });
      expect(r.ok, r.logs.join("\n")).toBe(true);
      const split = v1.legAmounts(amount, weights);
      for (const [i, stock] of w.stocks.slice(0, legs).entries()) {
        expect(w.env.tokenAmount(stock.ownerAta)).toBe(
          v1.expectedOut({
            amountIn: split[i]!,
            fundingDecimals: 6,
            outputDecimals: stock.decimals,
            price: feeds[i]!.price,
            expo: feeds[i]!.exponent,
            multiplierFp: v1.UNIT_MULTIPLIER_FP,
          }),
        );
      }

      const before = w.env.lamportsOf(w.keeper.address);
      const rent =
        w.env.lamportsOf(encodedVaa) +
        built.priceUpdates.reduce(
          (n, p) => n + w.env.lamportsOf(p.address),
          0n,
        );
      const cleanup = await w.env.trySend(w.keeper, built.cleanup);
      expect(cleanup.ok, cleanup.logs.join("\n")).toBe(true);
      expect(w.env.data(encodedVaa)).toBeNull();
      for (const p of built.priceUpdates)
        expect(w.env.data(p.address)).toBeNull();
      // All rent back to the keeper, minus one transaction fee (5,000 lamports per signature).
      expect(w.env.lamportsOf(w.keeper.address) - before).toBe(rent - 5_000n);
    },
  );

  test("a VAA signed by a key outside the guardian set is refused at verification", async () => {
    const { w } = await setup(1);
    const intruder: TestGuardian = createTestGuardian();
    const update = signedAccumulatorUpdate({
      guardians: [intruder],
      guardianSetIndex: GUARDIAN_SET_INDEX,
      source: DEVNET_SOURCE,
      feeds: feedsFor(w, 1),
      timestamp: Number(w.env.now),
      sequence: 2n,
    });
    const { results } = await prepareAndPost(w, update);
    const verify = results.find((r) => !r.ok)!;
    expect(verify.step).toMatch(/prepare/);
    // The recovered key is not the guardian's (core bridge `verify_guardian_signature`).
    expect(errorCode(verify.logs)).toBe("InvalidGuardianKeyRecovery");
    expect(
      results.filter((r) => r.step.startsWith("post")).every((r) => !r.ok),
    ).toBe(true);
  });

  test("a genuinely signed VAA from another emitter is refused by the receiver", async () => {
    const { w, guardian } = await setup(1);
    const other: DataSource = {
      chain: 26,
      emitter: (await generateKeyPairSigner()).address,
    };
    const update = signedAccumulatorUpdate({
      guardians: [guardian],
      guardianSetIndex: GUARDIAN_SET_INDEX,
      source: other,
      feeds: feedsFor(w, 1),
      timestamp: Number(w.env.now),
      sequence: 3n,
    });
    const { results } = await prepareAndPost(w, update);
    expect(
      results.filter((r) => r.step.startsWith("prepare")).every((r) => r.ok),
    ).toBe(true);
    const post = results.find((r) => r.step === "post 0")!;
    expect(post.ok).toBe(false);
    expect(errorCode(post.logs)).toBe("InvalidDataSource");
  });

  test("an encoded VAA that was written but never verified cannot be posted", async () => {
    const { w, guardian } = await setup(1);
    const update = signedAccumulatorUpdate({
      guardians: [guardian],
      guardianSetIndex: GUARDIAN_SET_INDEX,
      source: DEVNET_SOURCE,
      feeds: feedsFor(w, 1),
      timestamp: Number(w.env.now),
      sequence: 4n,
    });
    const { results } = await prepareAndPost(w, update, { skipVerify: true });
    expect(
      results.filter((r) => r.step.startsWith("prepare")).every((r) => r.ok),
    ).toBe(true);
    const post = results.find((r) => r.step === "post 0")!;
    expect(post.ok, "unverified VAA must be refused").toBe(false);
    expect(errorCode(post.logs)).toBe("UnverifiedVaa");
  });

  test("a keeper-held price update keypair is reused: overwritten in place, bound to its write authority", async () => {
    const { w, guardian } = await setup(1);
    const signed = (feeds: PriceFeedMessage[], sequence: bigint) =>
      signedAccumulatorUpdate({
        guardians: [guardian],
        guardianSetIndex: GUARDIAN_SET_INDEX,
        source: DEVNET_SOURCE,
        feeds,
        timestamp: Number(w.env.now),
        sequence,
      });
    const priceKey = await generateKeyPairSigner();
    const run1 = await prepareAndPost(w, signed(feedsFor(w, 1), 5n), {
      priceUpdateSigners: [priceKey],
      keep: true,
    });
    okAll(run1.results);
    expect(run1.built.cleanup).toHaveLength(1); // close_encoded_vaa only

    w.at(30n);
    const later = feedsFor(w, 1).map((f) => ({ ...f, price: f.price + 7n }));
    const run2 = await prepareAndPost(w, signed(later, 6n), {
      priceUpdateSigners: [priceKey],
      keep: true,
    });
    okAll(run2.results);
    const view = Buffer.from(w.env.data(priceKey.address)!);
    expect(view[40]).toBe(1);
    expect(view.readBigInt64LE(73)).toBe(later[0]!.price);
    expect(view.readBigInt64LE(93)).toBe(w.env.now);

    // Even with the account's keypair, another writer is refused: the receiver checks the
    // write authority recorded at creation.
    const stranger = await w.env.signer();
    const run3 = await prepareAndPost(w, signed(later, 7n), {
      keeper: stranger,
      priceUpdateSigners: [priceKey],
    });
    const post = run3.results.find((r) => r.step === "post 0")!;
    expect(post.ok).toBe(false);
    expect(errorCode(post.logs)).toBe("WrongWriteAuthority");
  });
});
