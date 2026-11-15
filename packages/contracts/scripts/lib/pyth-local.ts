/**
 * Local stand-ins for Pyth so the keeper's fully verified posting path runs against the REAL
 * Wormhole and Pyth receiver binaries without a Hermes API key:
 * - a test guardian (secp256k1 key generated at runtime, never written to disk);
 * - Wormhole guardian-set and receiver-config accounts that trust only that guardian;
 * - accumulator updates (merkle tree over price feed messages, VAA signed by the guardian);
 * - a loopback HTTP server answering `GET /v2/updates/price/latest` like Hermes.
 *
 * Prices are never invented here: the caller passes them (recorded real devnet prices).
 * What this does NOT prove: that real Wormhole guardians sign Hermes updates the same way;
 * that needs a Hermes API key (owner) and real devnet.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { getAddressEncoder, type Address } from "@solana/kit";
import {
  concatBytes,
  encodeAccumulatorUpdate,
  encodeGuardianSet,
  encodeMerkleRootPayload,
  encodePriceFeedMessage,
  encodeReceiverConfig,
  encodeVaa,
  encodeVaaBody,
  findGuardianSetPda,
  findReceiverConfigPda,
  PYTH_RECEIVER_ID,
  toBase64,
  WORMHOLE_PROGRAM_ID,
  type PriceFeedMessage,
} from "@ovelo/guard/pyth";

export type TestGuardian = {
  /** 20-byte Ethereum-style address (keccak256 of the public key, last 20 bytes). */
  ethAddress: Uint8Array;
  sign(digest: Uint8Array): Uint8Array;
};

/** A fresh guardian key held only in this process. */
export function createTestGuardian(): TestGuardian {
  const secret = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(secret, false).subarray(1);
  return {
    ethAddress: keccak_256(pub).subarray(12),
    sign(digest) {
      const sig = secp256k1.sign(digest, secret, { prehash: false });
      return concatBytes([
        sig.toCompactRawBytes(),
        Uint8Array.of(sig.recovery),
      ]);
    },
  };
}

const keccak160 = (...parts: Uint8Array[]) =>
  keccak_256(concatBytes(parts)).subarray(0, 20);
const hashLeaf = (data: Uint8Array) => keccak160(Uint8Array.of(0), data);
const hashNode = (a: Uint8Array, b: Uint8Array) => {
  const [lo, hi] =
    Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? [a, b] : [b, a];
  return keccak160(Uint8Array.of(1), lo, hi);
};

/** A Keccak160 merkle tree as pythnet_sdk verifies it (sorted pairs; an odd node moves up). */
export function merkleTree(leaves: readonly Uint8Array[]) {
  if (leaves.length === 0) throw new Error("A merkle tree needs a leaf.");
  let level = leaves.map((leaf, i) => ({ hash: hashLeaf(leaf), members: [i] }));
  const proofs: Uint8Array[][] = leaves.map(() => []);
  while (level.length > 1) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      for (const m of left.members) proofs[m]!.push(right.hash);
      for (const m of right.members) proofs[m]!.push(left.hash);
      next.push({
        hash: hashNode(left.hash, right.hash),
        members: [...left.members, ...right.members],
      });
    }
    level = next;
  }
  return { root: level[0]!.hash, proofs };
}

/** The data source a receiver config trusts (devnet: Pythnet chain 26). */
export type DataSource = { chain: number; emitter: Address };

export function signedAccumulatorUpdate(params: {
  guardians: readonly TestGuardian[];
  guardianSetIndex: number;
  source: DataSource;
  feeds: readonly PriceFeedMessage[];
  /** Unix seconds for the VAA timestamp. */
  timestamp: number;
  sequence: bigint;
  slot?: bigint;
}): Uint8Array {
  const messages = params.feeds.map(encodePriceFeedMessage);
  const tree = merkleTree(messages);
  const emitter = addressBytes(params.source.emitter);
  const body = encodeVaaBody({
    timestamp: params.timestamp,
    nonce: 0,
    emitterChain: params.source.chain,
    emitterAddress: emitter,
    sequence: params.sequence,
    consistencyLevel: 1,
    payload: encodeMerkleRootPayload({
      slot: params.slot ?? params.sequence,
      ringSize: 10_000,
      root: tree.root,
    }),
  });
  const digest = keccak_256(keccak_256(body));
  const vaa = encodeVaa({
    guardianSetIndex: params.guardianSetIndex,
    signatures: params.guardians.map((g, guardianIndex) => ({
      guardianIndex,
      signature: g.sign(digest),
    })),
    body,
  });
  return encodeAccumulatorUpdate({
    vaa,
    updates: messages.map((message, i) => ({
      message,
      proof: tree.proofs[i]!,
    })),
  });
}

const addressBytes = (address: Address): Uint8Array =>
  Uint8Array.from(getAddressEncoder().encode(address));

const rentExempt = (bytes: number) => (128 + bytes) * 6_960;

export type ValidatorAccount = {
  address: Address;
  owner: Address;
  data: Uint8Array;
  lamports: number;
  /** The JSON solana-test-validator expects for `--account <address> <file>`. */
  json: string;
};

function validatorAccount(
  address: Address,
  owner: Address,
  data: Uint8Array,
): ValidatorAccount {
  const lamports = rentExempt(data.length);
  return {
    address,
    owner,
    data,
    lamports,
    json: JSON.stringify({
      pubkey: address,
      account: {
        lamports,
        data: [toBase64(data), "base64"],
        owner,
        executable: false,
        rentEpoch: 0,
        space: data.length,
      },
    }),
  };
}

/** Guardian set + receiver config accounts that trust exactly these test guardians. */
export async function localPythAccounts(params: {
  guardians: readonly TestGuardian[];
  guardianSetIndex: number;
  source: DataSource;
  governance: Address;
  creationTime: number;
}): Promise<ValidatorAccount[]> {
  const guardianSet = encodeGuardianSet({
    index: params.guardianSetIndex,
    keys: params.guardians.map((g) => g.ethAddress),
    creationTime: params.creationTime,
    expirationTime: 0,
  });
  const config = encodeReceiverConfig({
    governanceAuthority: params.governance,
    targetGovernanceAuthority: null,
    wormhole: WORMHOLE_PROGRAM_ID,
    validDataSources: [params.source],
    singleUpdateFeeLamports: 0n,
    minimumSignatures: 1,
  });
  // Pad the config to the receiver's Config::LEN (370) as `initialize` allocates it.
  const padded = new Uint8Array(Math.max(370, config.length));
  padded.set(config);
  return [
    validatorAccount(
      await findGuardianSetPda(params.guardianSetIndex),
      WORMHOLE_PROGRAM_ID,
      guardianSet,
    ),
    validatorAccount(await findReceiverConfigPda(), PYTH_RECEIVER_ID, padded),
  ];
}

export type FakeHermesPrice = { price: bigint; conf: bigint; expo: number };

/**
 * A loopback Hermes for `GET /v2/updates/price/latest?ids[]=…`: one accumulator update
 * covering every requested feed, publish time = now, signed by the test guardians.
 * Unknown feeds answer 404, like Hermes. `prices` comes from the caller (recorded real data).
 */
export async function startFakeHermes(params: {
  port?: number;
  guardians: readonly TestGuardian[];
  guardianSetIndex: number;
  source: DataSource;
  prices: ReadonlyMap<string, FakeHermesPrice>;
  now?: () => number;
}): Promise<{ url: string; requests: number; close(): Promise<void> }> {
  const now = params.now ?? (() => Math.floor(Date.now() / 1000));
  let sequence = 1n;
  const state = { requests: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/v2/updates/price/latest") {
      res.writeHead(404).end();
      return;
    }
    const ids = url.searchParams
      .getAll("ids[]")
      .map((id) => `0x${id.replace(/^0x/, "").toLowerCase()}`);
    const known = ids.map((id) => [id, params.prices.get(id)] as const);
    if (ids.length === 0 || known.some(([, p]) => !p)) {
      res
        .writeHead(404, { "content-type": "application/json" })
        .end('{"message":"Price ids not found"}');
      return;
    }
    const t = now();
    const feeds: PriceFeedMessage[] = known.map(([id, p]) => ({
      feedId: id,
      price: p!.price,
      conf: p!.conf,
      exponent: p!.expo,
      publishTime: BigInt(t),
      prevPublishTime: BigInt(t - 1),
      emaPrice: p!.price,
      emaConf: p!.conf,
    }));
    const update = signedAccumulatorUpdate({
      guardians: params.guardians,
      guardianSetIndex: params.guardianSetIndex,
      source: params.source,
      feeds,
      timestamp: t,
      sequence: sequence++,
    });
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        binary: { encoding: "base64", data: [toBase64(update)] },
        parsed: feeds.map((f) => ({
          id: f.feedId.slice(2),
          price: {
            price: f.price.toString(),
            conf: f.conf.toString(),
            expo: f.exponent,
            publish_time: t,
          },
          ema_price: {
            price: f.emaPrice.toString(),
            conf: f.emaConf.toString(),
            expo: f.exponent,
            publish_time: t,
          },
        })),
      }),
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(params.port ?? 0, "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return state.requests;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
