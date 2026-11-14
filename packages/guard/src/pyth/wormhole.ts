/**
 * Instructions of the Wormhole core bridge the Pyth receiver verifies VAAs with on Solana
 * (`HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ` on devnet and mainnet). Only the
 * encoded-VAA path is built: create → init → write (chunks) → verify → (post) → close.
 *
 * Source: pyth-network/pyth-crosschain (main, read 2026-11-14),
 * `target_chains/solana/programs/core-bridge/src/processor/parse_and_verify_vaa/*.rs` and
 * `src/state/encoded_vaa.rs`: Anchor discriminators `sha256("global:<name>")[..8]`;
 * EncodedVaa = discriminator (8) ‖ Header { status u8, write_authority 32, version u8 } ‖
 * buf length u32 ‖ VAA bytes, so `init_encoded_vaa` needs a zeroed account of 46 + VAA bytes
 * owned by the bridge. Guardian sets are PDAs `["GuardianSet", index u32 BE]`; quorum is
 * `n / 2 + 1` signatures (`utils/mod.rs`).
 */
import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { concatBytes, u32le, u64le } from "./bytes";

export const WORMHOLE_PROGRAM_ID = address(
  "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ",
);
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

/** sha256("global:<name>")[..8], checked against node:crypto in the tests. */
export const WORMHOLE_DISCRIMINATORS = {
  initEncodedVaa: Uint8Array.of(209, 193, 173, 25, 91, 202, 181, 218),
  writeEncodedVaa: Uint8Array.of(199, 208, 110, 177, 150, 76, 118, 42),
  verifyEncodedVaaV1: Uint8Array.of(103, 56, 177, 229, 240, 103, 68, 73),
  closeEncodedVaa: Uint8Array.of(48, 221, 174, 198, 231, 7, 152, 38),
} as const;

/** sha256("account:EncodedVaa")[..8]. */
export const ENCODED_VAA_DISCRIMINATOR = Uint8Array.of(
  226,
  101,
  163,
  4,
  133,
  160,
  84,
  245,
);
/** sha256("account:GuardianSet")[..8] (the Anchor form; legacy sets have none). */
export const GUARDIAN_SET_DISCRIMINATOR = Uint8Array.of(
  120,
  77,
  74,
  98,
  34,
  83,
  96,
  125,
);
/** Bytes before the VAA in an EncodedVaa account. */
export const ENCODED_VAA_HEADER_BYTES = 8 + 1 + 32 + 1 + 4;

export const encodedVaaSpace = (vaaLength: number): number => {
  if (!Number.isInteger(vaaLength) || vaaLength <= 0)
    throw new Error("A VAA has at least one byte.");
  return ENCODED_VAA_HEADER_BYTES + vaaLength;
};

export const signerMeta = (
  signer: TransactionSigner,
  writable: boolean,
): AccountMeta =>
  ({
    address: signer.address,
    role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER,
    signer,
  }) as AccountMeta;

const meta = (addr: Address, writable: boolean): AccountMeta => ({
  address: addr,
  role: writable ? AccountRole.WRITABLE : AccountRole.READONLY,
});

export async function findGuardianSetPda(index: number): Promise<Address> {
  const be = new Uint8Array(4);
  new DataView(be.buffer).setUint32(0, index, false);
  const [pda] = await getProgramDerivedAddress({
    programAddress: WORMHOLE_PROGRAM_ID,
    seeds: [new TextEncoder().encode("GuardianSet"), be],
  });
  return pda;
}

/** System `create_account` for a new encoded-VAA account owned by the bridge. */
export function createEncodedVaaAccountInstruction(params: {
  payer: TransactionSigner;
  encodedVaa: TransactionSigner;
  vaaLength: number;
  lamports: bigint;
}): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM_ID,
    accounts: [
      signerMeta(params.payer, true),
      signerMeta(params.encodedVaa, true),
    ],
    data: concatBytes([
      u32le(0),
      u64le(params.lamports),
      u64le(BigInt(encodedVaaSpace(params.vaaLength))),
      Uint8Array.from(getAddressEncoder().encode(WORMHOLE_PROGRAM_ID)),
    ]),
  };
}

export function initEncodedVaaInstruction(params: {
  writeAuthority: TransactionSigner;
  encodedVaa: Address;
}): Instruction {
  return {
    programAddress: WORMHOLE_PROGRAM_ID,
    accounts: [
      signerMeta(params.writeAuthority, false),
      meta(params.encodedVaa, true),
    ],
    data: WORMHOLE_DISCRIMINATORS.initEncodedVaa.slice(),
  };
}

export function writeEncodedVaaInstruction(params: {
  writeAuthority: TransactionSigner;
  encodedVaa: Address;
  index: number;
  data: Uint8Array;
}): Instruction {
  if (params.data.length === 0) throw new Error("Write at least one byte.");
  return {
    programAddress: WORMHOLE_PROGRAM_ID,
    accounts: [
      signerMeta(params.writeAuthority, false),
      meta(params.encodedVaa, true),
    ],
    data: concatBytes([
      WORMHOLE_DISCRIMINATORS.writeEncodedVaa,
      u32le(params.index),
      u32le(params.data.length),
      params.data,
    ]),
  };
}

export function verifyEncodedVaaV1Instruction(params: {
  writeAuthority: TransactionSigner;
  encodedVaa: Address;
  guardianSet: Address;
}): Instruction {
  return {
    programAddress: WORMHOLE_PROGRAM_ID,
    accounts: [
      signerMeta(params.writeAuthority, false),
      meta(params.encodedVaa, true),
      meta(params.guardianSet, false),
    ],
    data: WORMHOLE_DISCRIMINATORS.verifyEncodedVaaV1.slice(),
  };
}

/**
 * A guardian set account in its Anchor form (as devnet's set 1 is stored): discriminator ‖
 * index u32 ‖ keys Vec<[u8; 20]> ‖ creation_time u32 ‖ expiration_time u32 (Borsh, LE).
 * Used by tests and the local validator, which write their own test guardian set.
 */
export function encodeGuardianSet(set: {
  index: number;
  keys: readonly Uint8Array[];
  creationTime: number;
  expirationTime: number;
}): Uint8Array {
  for (const key of set.keys)
    if (key.length !== 20) throw new Error("Guardian keys are 20 bytes.");
  return concatBytes([
    GUARDIAN_SET_DISCRIMINATOR,
    u32le(set.index),
    u32le(set.keys.length),
    ...set.keys,
    u32le(set.creationTime),
    u32le(set.expirationTime),
  ]);
}

/** Closes the encoded VAA; its rent goes to the write authority. */
export function closeEncodedVaaInstruction(params: {
  writeAuthority: TransactionSigner;
  encodedVaa: Address;
}): Instruction {
  return {
    programAddress: WORMHOLE_PROGRAM_ID,
    accounts: [
      signerMeta(params.writeAuthority, true),
      meta(params.encodedVaa, true),
    ],
    data: WORMHOLE_DISCRIMINATORS.closeEncodedVaa.slice(),
  };
}
