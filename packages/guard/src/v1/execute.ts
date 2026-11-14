/** Keeper builders for `execute_installment` (devnet-mock build in M6). */
import {
  AccountRole,
  type AccountMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getExecuteInstallmentInstruction, type Plan } from "./generated";
import {
  ACCOUNTS_PER_LEG,
  MAX_LEGS_PER_TRANSACTION,
  MAX_OUTPUTS,
  SUBSCRIPTIONS_PROGRAM_ID,
} from "./constants";
import {
  findAssetPda,
  findAssociatedTokenAddress,
  findConfigPda,
  findMockMintAuthorityPda,
  findSubscriptionsEventAuthorityPda,
} from "./pdas";
import { withRemaining } from "./builders";

/** Splits a plan's legs into transactions of at most `maxLegs` legs (one leg mask each). */
export function planLegBatches(
  outputs: number,
  maxLegs = MAX_LEGS_PER_TRANSACTION,
): number[] {
  if (outputs < 1 || outputs > MAX_OUTPUTS || maxLegs < 1)
    throw new Error("Invalid leg batching.");
  const masks: number[] = [];
  for (let start = 0; start < outputs; start += maxLegs) {
    let mask = 0;
    for (let leg = start; leg < Math.min(outputs, start + maxLegs); leg += 1)
      mask |= 1 << leg;
    masks.push(mask);
  }
  return masks;
}

export type LegInput = {
  mint: Address;
  tokenProgram: Address;
  priceUpdate: Address;
};

export async function buildExecuteInstallmentInstruction(params: {
  keeper: TransactionSigner;
  planAddress: Address;
  plan: Pick<
    Plan,
    | "owner"
    | "fundingMint"
    | "fundingTokenProgram"
    | "outputs"
    | "subscriptionAuthority"
    | "recurringDelegation"
  >;
  /** Owners of the treasury and fee token accounts (from Config). */
  treasury: Address;
  feeRecipient: Address | null;
  period: number;
  legMask: number;
  /** One entry per leg in the mask, in ascending leg order. */
  legs: LegInput[];
}): Promise<Instruction> {
  const { plan } = params;
  const indices = plan.outputs
    .map((_, i) => i)
    .filter((i) => (params.legMask >>> i) & 1);
  if (indices.length === 0 || indices.length !== params.legs.length)
    throw new Error("One leg input per leg in the mask.");
  indices.forEach((leg, k) => {
    if (plan.outputs[leg]?.mint !== params.legs[k]?.mint)
      throw new Error(`Leg ${leg} mint does not match the plan.`);
  });
  const remaining: AccountMeta[] = [];
  for (const leg of params.legs) {
    remaining.push(
      { address: await findAssetPda(leg.mint), role: AccountRole.READONLY },
      { address: leg.mint, role: AccountRole.WRITABLE },
      {
        address: await findAssociatedTokenAddress(
          plan.owner,
          leg.mint,
          leg.tokenProgram,
        ),
        role: AccountRole.WRITABLE,
      },
      { address: leg.priceUpdate, role: AccountRole.READONLY },
      {
        address: await findMockMintAuthorityPda(leg.mint),
        role: AccountRole.READONLY,
      },
      { address: leg.tokenProgram, role: AccountRole.READONLY },
    );
  }
  if (remaining.length !== params.legs.length * ACCOUNTS_PER_LEG)
    throw new Error("Leg account layout mismatch.");
  const token = (owner: Address) =>
    findAssociatedTokenAddress(
      owner,
      plan.fundingMint,
      plan.fundingTokenProgram,
    );
  return withRemaining(
    getExecuteInstallmentInstruction({
      keeper: params.keeper,
      config: await findConfigPda(),
      plan: params.planAddress,
      fundingMint: plan.fundingMint,
      fundingTokenProgram: plan.fundingTokenProgram,
      ownerFundingToken: await token(plan.owner),
      staging: await token(params.planAddress),
      treasuryToken: await token(params.treasury),
      feeToken: params.feeRecipient
        ? await token(params.feeRecipient)
        : undefined,
      subscriptionAuthority: plan.subscriptionAuthority,
      recurringDelegation: plan.recurringDelegation,
      subscriptionsEventAuthority: await findSubscriptionsEventAuthorityPda(),
      subscriptionsProgram: SUBSCRIPTIONS_PROGRAM_ID,
      period: params.period,
      legMask: params.legMask,
    }),
    remaining,
  );
}
