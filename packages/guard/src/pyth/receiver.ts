/**
 * Pyth Solana receiver (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`) instructions for FULLY
 * verified updates: `post_update` (needs an encoded VAA the Wormhole bridge has verified) and
 * `reclaim_rent`.
 *
 * Source: pyth-network/pyth-crosschain (main, read 2026-11-14),
 * `target_chains/solana/programs/pyth-solana-receiver/src/lib.rs` (`PostUpdate`, `ReclaimRent`,
 * `post_price_update_from_vaa`) and `pyth_solana_receiver_sdk/src/{lib,config,price_update}.rs`:
 * `PostUpdateParams { merkle_price_update: { message: Vec<u8>, proof: Vec<[u8; 20]> },
 * treasury_id: u8 }` in Borsh (u32 LE lengths); config PDA `["config"]`, treasury PDA
 * `["treasury", id]`; the price update account is a fresh keypair (`init_if_needed`) whose
 * write authority is recorded, and only it can reclaim the rent.
 */
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { concatBytes, u32le, u64le } from "./bytes";
import { MERKLE_NODE_BYTES } from "./accumulator";
import { signerMeta } from "./wormhole";

export const PYTH_RECEIVER_ID = address(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

export const RECEIVER_DISCRIMINATORS = {
  postUpdate: Uint8Array.of(133, 95, 207, 175, 11, 79, 118, 44),
  reclaimRent: Uint8Array.of(218, 200, 19, 197, 227, 89, 192, 22),
} as const;
/** sha256("account:Config")[..8] and sha256("account:PriceUpdateV2")[..8]. */
export const RECEIVER_CONFIG_DISCRIMINATOR = Uint8Array.of(
  155,
  12,
  170,
  224,
  30,
  250,
  204,
  130,
);
export const PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.of(
  34,
  241,
  35,
  99,
  157,
  126,
  244,
  205,
);
/** `PriceUpdateV2::LEN`. */
export const PRICE_UPDATE_V2_SPACE = 134;

const seed = (text: string) => new TextEncoder().encode(text);

export async function findReceiverConfigPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PYTH_RECEIVER_ID,
    seeds: [seed("config")],
  });
  return pda;
}

export async function findReceiverTreasuryPda(id: number): Promise<Address> {
  if (!Number.isInteger(id) || id < 0 || id > 255)
    throw new Error("Treasury id is a u8.");
  const [pda] = await getProgramDerivedAddress({
    programAddress: PYTH_RECEIVER_ID,
    seeds: [seed("treasury"), Uint8Array.of(id)],
  });
  return pda;
}

const meta = (addr: Address, writable: boolean): AccountMeta => ({
  address: addr,
  role: writable ? AccountRole.WRITABLE : AccountRole.READONLY,
});

export function encodePostUpdateParams(params: {
  message: Uint8Array;
  proof: readonly Uint8Array[];
  treasuryId: number;
}): Uint8Array {
  for (const node of params.proof)
    if (node.length !== MERKLE_NODE_BYTES)
      throw new Error("Merkle nodes are 20 bytes.");
  if (
    !Number.isInteger(params.treasuryId) ||
    params.treasuryId < 0 ||
    params.treasuryId > 255
  )
    throw new Error("Treasury id is a u8.");
  return concatBytes([
    RECEIVER_DISCRIMINATORS.postUpdate,
    u32le(params.message.length),
    params.message,
    u32le(params.proof.length),
    ...params.proof,
    Uint8Array.of(params.treasuryId),
  ]);
}

export async function postUpdateInstruction(params: {
  payer: TransactionSigner;
  writeAuthority: TransactionSigner;
  encodedVaa: Address;
  /**
   * The price update account's keypair. It must sign even when the account already exists
   * (Anchor `init_if_needed` without seeds keeps the signer constraint; verified in LiteSVM),
   * so reusing a keeper-held keypair saves rent, not transaction bytes.
   */
  priceUpdate: TransactionSigner;
  message: Uint8Array;
  proof: readonly Uint8Array[];
  treasuryId: number;
}): Promise<Instruction> {
  const priceUpdate = signerMeta(params.priceUpdate, true);
  return {
    programAddress: PYTH_RECEIVER_ID,
    accounts: [
      signerMeta(params.payer, true),
      meta(params.encodedVaa, false),
      meta(await findReceiverConfigPda(), false),
      meta(await findReceiverTreasuryPda(params.treasuryId), true),
      priceUpdate,
      meta(SYSTEM_PROGRAM_ID, false),
      signerMeta(params.writeAuthority, false),
    ],
    data: encodePostUpdateParams(params),
  };
}

/** Closes a price update account; `payer` must be its write authority and gets the rent. */
export function reclaimRentInstruction(params: {
  payer: TransactionSigner;
  priceUpdate: Address;
}): Instruction {
  return {
    programAddress: PYTH_RECEIVER_ID,
    accounts: [signerMeta(params.payer, true), meta(params.priceUpdate, true)],
    data: RECEIVER_DISCRIMINATORS.reclaimRent.slice(),
  };
}

export type ReceiverConfig = {
  governanceAuthority: Address;
  targetGovernanceAuthority: Address | null;
  wormhole: Address;
  validDataSources: { chain: number; emitter: Address }[];
  singleUpdateFeeLamports: bigint;
  minimumSignatures: number;
};

/** Encodes a receiver Config account (tests and the local validator write their own). */
export function encodeReceiverConfig(config: ReceiverConfig): Uint8Array {
  const key = (a: Address) => Uint8Array.from(getAddressEncoder().encode(a));
  const sources = config.validDataSources.map((s) => {
    const chain = new Uint8Array(2);
    new DataView(chain.buffer).setUint16(0, s.chain, true);
    return concatBytes([chain, key(s.emitter)]);
  });
  return concatBytes([
    RECEIVER_CONFIG_DISCRIMINATOR,
    key(config.governanceAuthority),
    config.targetGovernanceAuthority
      ? concatBytes([Uint8Array.of(1), key(config.targetGovernanceAuthority)])
      : Uint8Array.of(0),
    key(config.wormhole),
    u32le(sources.length),
    ...sources,
    u64le(config.singleUpdateFeeLamports),
    Uint8Array.of(config.minimumSignatures),
  ]);
}

/** Decodes the receiver's Config account (Borsh, little-endian). */
export function decodeReceiverConfig(data: Uint8Array): ReceiverConfig {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!RECEIVER_CONFIG_DISCRIMINATOR.every((b, i) => data[i] === b))
    throw new Error("Not a Pyth receiver config account.");
  const addr = getAddressDecoder();
  let o = 8;
  const key = () => {
    if (o + 32 > data.length) throw new Error("Receiver config is truncated.");
    const value = addr.decode(data.subarray(o, o + 32));
    o += 32;
    return value;
  };
  const governanceAuthority = key();
  const hasTarget = data[o++];
  const targetGovernanceAuthority = hasTarget === 1 ? key() : null;
  const wormhole = key();
  const count = view.getUint32(o, true);
  o += 4;
  const validDataSources: ReceiverConfig["validDataSources"] = [];
  for (let i = 0; i < count; i += 1) {
    const chain = view.getUint16(o, true);
    o += 2;
    validDataSources.push({ chain, emitter: key() });
  }
  const singleUpdateFeeLamports = view.getBigUint64(o, true);
  const minimumSignatures = view.getUint8(o + 8);
  return {
    governanceAuthority,
    targetGovernanceAuthority,
    wormhole,
    validDataSources,
    singleUpdateFeeLamports,
    minimumSignatures,
  };
}
