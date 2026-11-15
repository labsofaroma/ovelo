/**
 * Test-only tampering with a built `execute_installment_routed` instruction, to prove each
 * refusal ON CHAIN (the client builder refuses these routes before signing).
 */
import { type AccountRole, type Address, type Instruction } from "@solana/kit";
import {
  getExecuteInstallmentRoutedInstructionDataDecoder,
  getExecuteInstallmentRoutedInstructionDataEncoder,
} from "@ovelo/guard/generated";

/** Named accounts of `ExecuteInstallment` (13, the optional fee slot included). */
export const NAMED = 13;

type Ix = Instruction & {
  accounts: { address: Address; role: AccountRole }[];
  data: Uint8Array;
};

function routes(ix: Ix) {
  return getExecuteInstallmentRoutedInstructionDataDecoder().decode(ix.data)
    .routes;
}

/** Index in `ix.accounts` of route account `i` of leg `k` (k-th leg in the mask). */
export function routeIndex(ix: Ix, k: number, i: number): number {
  let at = NAMED;
  const r = routes(ix);
  for (let j = 0; j < k; j += 1) at += 2 + r[j]!.accountCount;
  return at + 2 + i;
}

/** Replace route account `i` of leg `k` (and optionally its role). */
export function patchAccount(
  ixs: Instruction[],
  k: number,
  i: number,
  address: Address,
  role?: AccountRole,
): Instruction[] {
  const [budget, ix] = ixs as [Instruction, Ix];
  const accounts = ix.accounts.map((a) => ({ ...a }));
  const at = routeIndex(ix, k, i);
  accounts[at] = { address, role: role ?? accounts[at]!.role };
  return [budget, { ...ix, accounts }];
}

/** Rewrite leg `k`'s Jupiter data. */
export function patchData(
  ixs: Instruction[],
  k: number,
  edit: (data: Uint8Array) => Uint8Array,
): Instruction[] {
  const [budget, ix] = ixs as [Instruction, Ix];
  const decoded = getExecuteInstallmentRoutedInstructionDataDecoder().decode(
    ix.data,
  );
  const next = decoded.routes.map((r, j) =>
    j === k ? { ...r, data: edit(Uint8Array.from(r.data)) } : r,
  );
  const data = getExecuteInstallmentRoutedInstructionDataEncoder().encode({
    ...decoded,
    routes: next,
  });
  return [budget, { ...ix, data: Uint8Array.from(data) }];
}

export const setU16 = (offset: number, value: number) => (d: Uint8Array) => {
  new DataView(d.buffer, d.byteOffset).setUint16(offset, value, true);
  return d;
};
