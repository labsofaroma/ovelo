import {
  address,
  getAddressDecoder,
  type Address,
  type AddressesByLookupTableAddress,
} from "@solana/kit";
import type { KeeperRpc } from "../rpc";

/**
 * Address lookup tables named by Jupiter, verified against the chain with M4's rules
 * (features/trade/server/lookup-tables.ts): owned by the lookup-table program, active (never
 * deactivated), and holding every address Jupiter relied on at the index it relied on. The
 * chain's contents are what the transaction uses.
 */

export const LOOKUP_TABLE_PROGRAM = address(
  "AddressLookupTab1e1111111111111111111111111",
);
const HEADER = 56;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

export class LookupTableRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupTableRejected";
  }
}

export function decodeLookupTable(data: Uint8Array): {
  deactivationSlot: bigint;
  addresses: Address[];
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    data.length < HEADER ||
    view.getUint32(0, true) !== 1 ||
    (data.length - HEADER) % 32 !== 0
  )
    throw new LookupTableRejected("not an address lookup table");
  const decoder = getAddressDecoder();
  const addresses: Address[] = [];
  for (let at = HEADER; at < data.length; at += 32)
    addresses.push(decoder.decode(data.subarray(at, at + 32)));
  return { deactivationSlot: view.getBigUint64(4, true), addresses };
}

export function mergeLookupTables(
  mappings: readonly Record<string, string[]>[],
): Map<string, string[]> {
  const required = new Map<string, string[]>();
  for (const mapping of mappings)
    for (const [key, addresses] of Object.entries(mapping)) {
      if (!Array.isArray(addresses) || addresses.length > 256)
        throw new LookupTableRejected("invalid lookup table metadata");
      const previous = required.get(key);
      if (
        previous &&
        addresses.some((a, i) => previous[i] !== undefined && previous[i] !== a)
      )
        throw new LookupTableRejected("inconsistent lookup table metadata");
      required.set(
        key,
        previous && previous.length > addresses.length ? previous : addresses,
      );
    }
  if (required.size > 32)
    throw new LookupTableRejected("too many lookup tables");
  return required;
}

export async function verifiedLookupTables(
  rpc: KeeperRpc,
  mappings: readonly Record<string, string[]>[],
): Promise<AddressesByLookupTableAddress> {
  const required = mergeLookupTables(mappings);
  if (!required.size) return {};
  const keys = [...required.keys()].map((k) => address(k));
  const { value } = await rpc
    .getMultipleAccounts(keys, { encoding: "base64", commitment: "confirmed" })
    .send();
  const out: AddressesByLookupTableAddress = {};
  keys.forEach((key, i) => {
    const account = value[i];
    if (!account || account.owner !== LOOKUP_TABLE_PROGRAM)
      throw new LookupTableRejected(
        `lookup table ${key} is not owned by the lookup-table program`,
      );
    const table = decodeLookupTable(
      Uint8Array.from(Buffer.from(account.data[0], "base64")),
    );
    if (table.deactivationSlot !== U64_MAX)
      throw new LookupTableRejected(`lookup table ${key} is deactivated`);
    const expected = required.get(key) ?? [];
    if (expected.some((a, index) => table.addresses[index] !== a))
      throw new LookupTableRejected(
        `lookup table ${key} changed; request a new route`,
      );
    out[key] = table.addresses;
  });
  return out;
}
