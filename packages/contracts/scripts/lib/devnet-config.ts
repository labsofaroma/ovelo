/** Ovelo Guard v1 devnet config from the M6 product decisions (REWRITE-PLAN M6 status). */
import type { Address } from "@solana/kit";
import type * as v1 from "@ovelo/guard";

const NONE = "11111111111111111111111111111111" as Address;
const four = (first?: Address) => [first ?? NONE, NONE, NONE, NONE];

export const DEVNET_DECISIONS = {
  maxSlippageBps: 300,
  maxOracleStalenessS: 60,
  catchUpWindowPeriods: 1, // decision 3
  protocolFeeBps: 0, // decision 2
  maxInstallmentAmount: 500_000_000n, // 500 tUSD launch cap
  maxConfidenceBps: 200,
} as const;

/** Decision 1: the devnet keeper; decision 4: the test USD is the only funding mint. */
export function devnetConfig(o: {
  admin: Address;
  keeper: Address;
  testUsd: Address;
  treasury: Address;
}): v1.ConfigParamsArgs {
  return {
    admin: o.admin,
    keeperAuthority: o.keeper,
    allowedFundingMints: four(o.testUsd),
    ...DEVNET_DECISIONS,
    feeRecipient: NONE,
    treasury: o.treasury,
    // Devnet mock stocks have no freeze authority, permanent delegate or hook (decision 5).
    allowedFreezeAuthorities: four(),
    allowedPermanentDelegates: four(),
    allowedTransferHookPrograms: four(),
  };
}

export const NULL_KEY = NONE;
