import "server-only";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
} from "@solana/web3.js";
import { AppError } from "@/server/errors";
import { mainnetRpc, type MainnetRpc, type RpcAccount } from "./rpc";

const U64_MAX = BigInt("18446744073709551615");
const bad = (detail: string) => new AppError("ROUTE_UNAVAILABLE", { detail });

/**
 * Ported from the prototype's jupiter-lookup-tables.ts. Only tables named by Jupiter are loaded, and
 * the RPC's real table contents are authoritative: owner, activation and every address Jupiter
 * relied on must match, or the route is refused.
 */
export async function loadVerifiedLookupTables(
  mappings: readonly (Record<string, string[]> | null)[],
  rpc: MainnetRpc = mainnetRpc,
): Promise<AddressLookupTableAccount[]> {
  const required = new Map<string, string[]>();
  for (const mapping of mappings) {
    if (!mapping) continue;
    for (const [key, addresses] of Object.entries(mapping)) {
      let canonical: string;
      try {
        canonical = new PublicKey(key).toBase58();
      } catch {
        throw bad("Invalid Jupiter lookup table metadata.");
      }
      if (
        canonical !== key ||
        !Array.isArray(addresses) ||
        addresses.length > 256
      )
        throw bad("Invalid Jupiter lookup table metadata.");
      const previous = required.get(key);
      if (previous && previous.some((value, i) => addresses[i] !== value))
        throw bad("Jupiter returned inconsistent lookup table metadata.");
      required.set(key, addresses);
    }
  }
  if (!required.size) return [];
  if (required.size > 32) throw bad("Too many lookup tables for this basket.");
  const keys = [...required.keys()];
  const { value } = await rpc<{ value: RpcAccount[] }>("getMultipleAccounts", [
    keys,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (value.length !== keys.length)
    throw bad("Mainnet lookup tables are unavailable.");
  return value.map((account, i) => {
    if (
      !account ||
      account.executable ||
      account.owner !== AddressLookupTableProgram.programId.toBase58()
    )
      throw bad(
        "Jupiter lookup table is not owned by the mainnet lookup-table program.",
      );
    const state = AddressLookupTableAccount.deserialize(
      Buffer.from(account.data[0], "base64"),
    );
    const expected = required.get(keys[i]!) ?? [];
    if (
      state.deactivationSlot !== U64_MAX ||
      expected.some(
        (address, index) => state.addresses[index]?.toBase58() !== address,
      )
    )
      throw bad(
        "Jupiter lookup table changed or is deactivated. Request a new quote.",
      );
    return new AddressLookupTableAccount({
      key: new PublicKey(keys[i]!),
      state,
    });
  });
}
