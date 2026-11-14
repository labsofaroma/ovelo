/**
 * Instruction builders for Aroma Guard v1. The server prepares instructions; wallets sign them.
 * Amounts are bigint raw units. Every multi-instruction flow returns the instructions of ONE
 * transaction, in order.
 */
import {
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type AccountMeta,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  UNKNOWN_INIT_ID,
  getCreateRecurringDelegationInstruction,
  getInitSubscriptionAuthorityInstruction,
  getRevokeDelegationInstruction,
  getRevokeSubscriptionAuthorityInstruction,
} from "@solana/subscriptions";
import {
  getClosePlanInstruction,
  getCreatePlanInstruction,
  type OutputArgs,
  type Plan,
} from "./generated";
import { MAX_OUTPUTS, TOTAL_WEIGHT_BPS } from "./constants";
import { findAssetPda, planAddresses } from "./pdas";
import { delegationTerms, legAmounts } from "./schedule";

export const withRemaining = <T extends Instruction>(
  ix: T,
  extra: AccountMeta[],
): T => ({
  ...ix,
  accounts: [...(ix.accounts ?? []), ...extra],
});

export type CreatePlanParams = {
  owner: TransactionSigner;
  fundingMint: Address;
  fundingTokenProgram: Address;
  nonce: bigint;
  fundingAmount: bigint;
  periodSeconds: bigint;
  startsAt: bigint;
  periods: number;
  outputs: OutputArgs[];
  /** `Config.catch_up_window_periods` read from chain; the delegation terms depend on it. */
  catchUpWindowPeriods: number;
  /**
   * The owner's SubscriptionAuthority for this mint: `null` when it does not exist yet (it is
   * created in the same transaction and approves its PDA on the owner's token account), else
   * its current `initId`.
   */
  subscriptionAuthorityInitId: bigint | null;
};

/** Client-side checks that mirror `create_plan` (the program re-checks everything). */
export function assertPlanParams(p: CreatePlanParams): void {
  if (p.fundingAmount <= 0n || p.fundingAmount >= 2n ** 64n)
    throw new Error("Choose a positive installment amount.");
  if (p.periods < 1 || !Number.isInteger(p.periods))
    throw new Error("Choose at least one period.");
  if (p.outputs.length < 1 || p.outputs.length > MAX_OUTPUTS)
    throw new Error(`Choose 1 to ${MAX_OUTPUTS} assets.`);
  const mints = new Set(p.outputs.map((o) => o.mint));
  if (mints.size !== p.outputs.length || mints.has(p.fundingMint))
    throw new Error(
      "Assets must be distinct and differ from the funding token.",
    );
  const total = p.outputs.reduce((sum, o) => sum + o.weightBps, 0);
  if (total !== TOTAL_WEIGHT_BPS || p.outputs.some((o) => o.weightBps <= 0))
    throw new Error("Weights must be positive and sum to 10,000 bps.");
  if (
    legAmounts(
      p.fundingAmount,
      p.outputs.map((o) => o.weightBps),
    ).some((a) => a === 0n)
  )
    throw new Error("Every asset must receive part of each installment.");
}

/**
 * One transaction: [init SubscriptionAuthority (first plan for this mint)], create the
 * recurring delegation to the plan PDA with the terms the program requires, create the plan.
 */
export async function buildCreatePlanInstructions(
  p: CreatePlanParams,
): Promise<Instruction[]> {
  assertPlanParams(p);
  const a = await planAddresses({ ...p, owner: p.owner.address });
  const expiresAt = p.startsAt + p.periodSeconds * BigInt(p.periods);
  const terms = delegationTerms(
    p.fundingAmount,
    p.catchUpWindowPeriods,
    p.periodSeconds,
    expiresAt,
  );
  const instructions: Instruction[] = [];
  if (p.subscriptionAuthorityInitId === null) {
    instructions.push(
      getInitSubscriptionAuthorityInstruction({
        owner: p.owner,
        subscriptionAuthority: a.subscriptionAuthority,
        tokenMint: p.fundingMint,
        userAta: a.ownerFundingToken,
        tokenProgram: p.fundingTokenProgram,
      }),
    );
  }
  instructions.push(
    getCreateRecurringDelegationInstruction({
      delegator: p.owner,
      subscriptionAuthority: a.subscriptionAuthority,
      delegationAccount: a.recurringDelegation,
      delegatee: a.plan,
      recurringDelegation: {
        nonce: p.nonce,
        amountPerPeriod: terms.amountPerPeriod,
        periodLengthS: p.periodSeconds,
        startTs: p.startsAt,
        expiryTs: terms.expiry,
        // Same transaction as the authority's creation: the slot-scoped sentinel (upstream 0.5.0).
        expectedSubscriptionAuthorityInitId:
          p.subscriptionAuthorityInitId ?? UNKNOWN_INIT_ID,
      },
    }),
  );
  const assets = await Promise.all(p.outputs.map((o) => findAssetPda(o.mint)));
  instructions.push(
    withRemaining(
      getCreatePlanInstruction({
        owner: p.owner,
        config: a.config,
        plan: a.plan,
        fundingMint: p.fundingMint,
        fundingTokenProgram: p.fundingTokenProgram,
        ownerFundingToken: a.ownerFundingToken,
        staging: a.staging,
        subscriptionAuthority: a.subscriptionAuthority,
        recurringDelegation: a.recurringDelegation,
        nonce: p.nonce,
        fundingAmount: p.fundingAmount,
        periodSeconds: p.periodSeconds,
        startsAt: p.startsAt,
        periods: p.periods,
        outputs: p.outputs,
      }),
      assets.map((address) => ({ address, role: AccountRole.READONLY })),
    ),
  );
  return instructions;
}

/**
 * ONE transaction: close the plan (staging refunded, rent to the owner) and revoke its
 * Subscriptions delegation. With `revokeAuthority` (the owner's last plan for this funding
 * mint), also revoke the SubscriptionAuthority, which removes its token-account approval.
 */
export async function buildCloseAndRevokeInstructions(params: {
  owner: TransactionSigner;
  planAddress: Address;
  plan: Pick<
    Plan,
    | "owner"
    | "fundingMint"
    | "fundingTokenProgram"
    | "nonce"
    | "recurringDelegation"
  >;
  revokeAuthority: boolean;
}): Promise<Instruction[]> {
  const { owner, plan } = params;
  if (owner.address !== plan.owner)
    throw new Error("Only the plan owner can close it.");
  const a = await planAddresses({ ...plan, owner: plan.owner });
  if (a.plan !== params.planAddress)
    throw new Error("Plan address does not match its seeds.");
  const instructions: Instruction[] = [
    getClosePlanInstruction({
      owner,
      plan: params.planAddress,
      fundingMint: plan.fundingMint,
      fundingTokenProgram: plan.fundingTokenProgram,
      staging: a.staging,
      ownerFundingToken: a.ownerFundingToken,
    }),
    getRevokeDelegationInstruction({
      authority: owner,
      delegationAccount: plan.recurringDelegation,
    }),
  ];
  if (params.revokeAuthority) {
    instructions.push(
      getRevokeSubscriptionAuthorityInstruction({
        user: owner,
        subscriptionAuthority: a.subscriptionAuthority,
        tokenMint: plan.fundingMint,
        userAta: a.ownerFundingToken,
        tokenProgram: plan.fundingTokenProgram,
      }),
    );
  }
  return instructions;
}

/** A single-transaction message (fee payer + blockhash) for a list of instructions. */
export function singleTransactionMessage(
  feePayer: TransactionSigner,
  blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint },
  instructions: Instruction[],
) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}
