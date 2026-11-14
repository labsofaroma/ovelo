/**
 * `execute_installment_routed` (mainnet build): one Jupiter `route_v2` swap per leg. Remaining
 * accounts per leg, ascending leg order: `[asset, price_update, …route accounts]`.
 */
import {
  AccountRole,
  type AccountMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  getExecuteInstallmentRoutedInstruction,
  type Plan,
} from "../generated";
import { SUBSCRIPTIONS_PROGRAM_ID } from "../constants";
import {
  findAssetPda,
  findAssociatedTokenAddress,
  findConfigPda,
  findSubscriptionsEventAuthorityPda,
} from "../pdas";
import { withRemaining } from "../builders";
import { bpsOf, legAmounts } from "../schedule";
import { swapAccountsFor } from "./pdas";
import { checkRouteLeg, type JupiterRoute } from "./route";

export type RoutedLegInput = {
  mint: Address;
  tokenProgram: Address;
  priceUpdate: Address;
  route: JupiterRoute;
};

export type RoutedPlan = Pick<
  Plan,
  | "owner"
  | "fundingMint"
  | "fundingTokenProgram"
  | "fundingAmount"
  | "outputs"
  | "subscriptionAuthority"
  | "recurringDelegation"
>;

/** What leg `leg` spends: its weight share, the protocol fee, and `amount_in` for the route. */
export function routedLegAmounts(
  plan: Pick<Plan, "fundingAmount" | "outputs">,
  leg: number,
  protocolFeeBps: number,
): { legFunding: bigint; fee: bigint; amountIn: bigint } {
  const amounts = legAmounts(
    plan.fundingAmount,
    plan.outputs.map((o) => o.weightBps),
  );
  const legFunding = amounts[leg];
  if (legFunding === undefined) throw new Error(`plan has no leg ${leg}`);
  const fee = bpsOf(legFunding, protocolFeeBps);
  return { legFunding, fee, amountIn: legFunding - fee };
}

export async function buildExecuteInstallmentRoutedInstruction(params: {
  keeper: TransactionSigner;
  planAddress: Address;
  plan: RoutedPlan;
  /** `config.treasury` (the account is required by the shared accounts struct, unused here). */
  treasury: Address;
  feeRecipient: Address | null;
  protocolFeeBps: number;
  period: number;
  legMask: number;
  /** One entry per leg in the mask, ascending. */
  legs: RoutedLegInput[];
}): Promise<Instruction> {
  const { plan } = params;
  const indices = plan.outputs
    .map((_, i) => i)
    .filter((i) => (params.legMask >>> i) & 1);
  if (indices.length === 0 || indices.length !== params.legs.length)
    throw new Error("One leg input per leg in the mask.");
  if (params.protocolFeeBps > 0 && !params.feeRecipient)
    throw new Error("A protocol fee needs the fee recipient's account.");
  const token = (owner: Address) =>
    findAssociatedTokenAddress(
      owner,
      plan.fundingMint,
      plan.fundingTokenProgram,
    );
  const named = {
    config: await findConfigPda(),
    ownerFundingToken: await token(plan.owner),
    staging: await token(params.planAddress),
    treasuryToken: await token(params.treasury),
    feeToken: params.feeRecipient
      ? await token(params.feeRecipient)
      : undefined,
    subscriptionsEventAuthority: await findSubscriptionsEventAuthorityPda(),
  };
  const forbidden = [
    params.planAddress,
    named.config,
    named.ownerFundingToken,
    named.staging,
    named.treasuryToken,
    ...(named.feeToken ? [named.feeToken] : []),
    plan.subscriptionAuthority,
    plan.recurringDelegation,
    named.subscriptionsEventAuthority,
    SUBSCRIPTIONS_PROGRAM_ID,
  ];
  const remaining: AccountMeta[] = [];
  const routes: { accountCount: number; data: Uint8Array }[] = [];
  for (const [k, leg] of indices.entries()) {
    const input = params.legs[k]!;
    if (plan.outputs[leg]?.mint !== input.mint)
      throw new Error(`Leg ${leg} mint does not match the plan.`);
    const swap = await swapAccountsFor({
      fundingMint: plan.fundingMint,
      fundingTokenProgram: plan.fundingTokenProgram,
      outputMint: input.mint,
      outputTokenProgram: input.tokenProgram,
    });
    checkRouteLeg(input.route, {
      swapAuthority: swap.authority,
      source: swap.source,
      transit: swap.transit,
      fundingMint: plan.fundingMint,
      fundingTokenProgram: plan.fundingTokenProgram,
      outputMint: input.mint,
      outputTokenProgram: input.tokenProgram,
      destination: await findAssociatedTokenAddress(
        plan.owner,
        input.mint,
        input.tokenProgram,
      ),
      amountIn: routedLegAmounts(plan, leg, params.protocolFeeBps).amountIn,
      forbidden,
    });
    remaining.push(
      { address: await findAssetPda(input.mint), role: AccountRole.READONLY },
      { address: input.priceUpdate, role: AccountRole.READONLY },
      ...input.route.accounts.map((a) => ({
        address: a.address,
        role: a.role,
      })),
    );
    routes.push({
      accountCount: input.route.accounts.length,
      data: input.route.data,
    });
  }
  return withRemaining(
    getExecuteInstallmentRoutedInstruction({
      keeper: params.keeper,
      plan: params.planAddress,
      fundingMint: plan.fundingMint,
      fundingTokenProgram: plan.fundingTokenProgram,
      subscriptionAuthority: plan.subscriptionAuthority,
      recurringDelegation: plan.recurringDelegation,
      subscriptionsProgram: SUBSCRIPTIONS_PROGRAM_ID,
      ...named,
      period: params.period,
      legMask: params.legMask,
      routes,
    }),
    remaining,
  );
}
