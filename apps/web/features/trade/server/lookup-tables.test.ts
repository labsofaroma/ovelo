import {
  AddressLookupTableProgram,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import { expect, it } from "vitest";
import { loadVerifiedLookupTables } from "./lookup-tables";
import type { MainnetRpc, RpcAccount } from "./rpc";

/** Ported from tests/jupiter-lookup-tables.test.ts. */
const tableKey = Keypair.fromSeed(
  new Uint8Array(32).fill(1),
).publicKey.toBase58();
const address = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const map = { [tableKey]: [address.toBase58()] };

function tableAccount(active = true): NonNullable<RpcAccount> {
  const data = Buffer.alloc(88);
  data.writeUInt32LE(1, 0);
  data.writeBigUInt64LE(
    active ? BigInt("18446744073709551615") : BigInt(100),
    4,
  );
  address.toBuffer().copy(data, 56);
  return {
    executable: false,
    lamports: 1,
    owner: AddressLookupTableProgram.programId.toBase58(),
    data: [data.toString("base64"), "base64"],
  };
}
const reader =
  (account: RpcAccount): MainnetRpc =>
  async <T>(method: string, params?: unknown[]) => {
    expect(method).toBe("getMultipleAccounts");
    expect(params?.[0]).toEqual([tableKey]);
    return { value: [account] } as T;
  };

it("lookup tables use actual mainnet account data and reject owner, contents and activation mismatches", async () => {
  const loaded = await loadVerifiedLookupTables(
    [map, map],
    reader(tableAccount()),
  );
  expect(loaded).toHaveLength(1);
  expect(loaded[0]!.state.addresses[0]!.equals(address)).toBe(true);
  await expect(loadVerifiedLookupTables([map], reader(null))).rejects.toThrow(
    /not owned/,
  );
  await expect(
    loadVerifiedLookupTables(
      [map],
      reader({ ...tableAccount(), owner: SystemProgram.programId.toBase58() }),
    ),
  ).rejects.toThrow(/not owned/);
  await expect(
    loadVerifiedLookupTables([map], reader(tableAccount(false))),
  ).rejects.toThrow(/deactivated/);
  await expect(
    loadVerifiedLookupTables(
      [{ [tableKey]: [SystemProgram.programId.toBase58()] }],
      reader(tableAccount()),
    ),
  ).rejects.toThrow(/changed/);
  await expect(
    loadVerifiedLookupTables(
      [map, { [tableKey]: [SystemProgram.programId.toBase58()] }],
      reader(tableAccount()),
    ),
  ).rejects.toThrow(/inconsistent/);
});

it("no mappings: no RPC call; malformed or oversized metadata is rejected", async () => {
  let called = false;
  const spy: MainnetRpc = async <T>() => {
    called = true;
    return { value: [] } as T;
  };
  expect(await loadVerifiedLookupTables([null, null], spy)).toEqual([]);
  expect(called).toBe(false);
  await expect(
    loadVerifiedLookupTables([{ "not-a-key": [] }], spy),
  ).rejects.toThrow();
  await expect(
    loadVerifiedLookupTables(
      [{ [tableKey]: Array.from({ length: 257 }, () => tableKey) }],
      spy,
    ),
  ).rejects.toThrow(/lookup table metadata/);
});
