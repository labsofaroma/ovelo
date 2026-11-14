/** Small shared helpers for the LiteSVM suite. */
import { address, type Address, type Instruction } from "@solana/kit";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as v1 from "@aroma/guard";
import { kitIx, pk } from "./harness";

export const DEFAULT = "11111111111111111111111111111111" as Address;
export const COMPUTE_BUDGET = address(
  "ComputeBudget111111111111111111111111111111",
);
export const cuLimit = (units: number): Instruction => {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET, accounts: [], data };
};

/** Idempotent ATA creation for `owner` (payer = owner). */
export function ataIx(
  owner: Address,
  mint: Address,
  tokenProgram: Address = v1.TOKEN_2022_PROGRAM_ID,
): Instruction {
  const program = pk(tokenProgram);
  const ata = getAssociatedTokenAddressSync(pk(mint), pk(owner), true, program);
  return kitIx(
    createAssociatedTokenAccountIdempotentInstruction(
      pk(owner),
      ata,
      pk(owner),
      pk(mint),
      program,
    ),
  );
}

export function evenWeights(n: number): number[] {
  return Array.from(
    { length: n },
    (_, i) => Math.floor(10_000 / n) + (i < 10_000 % n ? 1 : 0),
  );
}

export function configParams(o: {
  admin: Address;
  keeper: Address | null;
  usd: Address;
  treasury: Address;
  feeRecipient: Address;
  feeBps: number;
  window: number;
  maxInstallment: bigint;
}): v1.ConfigParamsArgs {
  const four = (first?: Address) => [
    first ?? DEFAULT,
    DEFAULT,
    DEFAULT,
    DEFAULT,
  ];
  return {
    admin: o.admin,
    keeperAuthority: o.keeper,
    allowedFundingMints: four(o.usd),
    maxSlippageBps: 300,
    maxOracleStalenessS: 60,
    catchUpWindowPeriods: o.window,
    protocolFeeBps: o.feeBps,
    feeRecipient: o.feeRecipient,
    maxInstallmentAmount: o.maxInstallment,
    maxConfidenceBps: 200,
    treasury: o.treasury,
    allowedFreezeAuthorities: four(),
    allowedPermanentDelegates: four(),
    allowedTransferHookPrograms: four(),
  };
}

/** Error code name from logs ("Error Code: X"), for assertions. */
export function errorCode(logs: string[]): string | null {
  for (const line of logs) {
    const m = /Error Code: (\w+)/.exec(line);
    if (m) return m[1] ?? null;
  }
  return null;
}
