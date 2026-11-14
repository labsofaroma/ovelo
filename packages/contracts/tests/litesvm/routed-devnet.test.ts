/** The devnet-mock build has no swap path: the routed instruction is refused (M8). */
import { expect, test } from "vitest";
import { getExecuteInstallmentRoutedInstruction } from "@aroma/guard/generated";
import * as v1 from "@aroma/guard";
import { errorCode, World } from "./world";

test("devnet-mock build refuses execute_installment_routed", async () => {
  const w = await World.create({ stocks: 1 });
  const plan = await w.createPlan({ periods: 3 });
  const p = w.plan(plan);
  const token = (owner: Parameters<typeof v1.findAssociatedTokenAddress>[0]) =>
    v1.findAssociatedTokenAddress(owner, w.usd, v1.TOKEN_PROGRAM_ID);
  const ix = getExecuteInstallmentRoutedInstruction({
    keeper: w.keeper,
    config: await v1.findConfigPda(),
    plan,
    fundingMint: w.usd,
    fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
    ownerFundingToken: w.ownerUsd,
    staging: await token(plan),
    treasuryToken: await token(w.treasury.address),
    subscriptionAuthority: p.subscriptionAuthority,
    recurringDelegation: p.recurringDelegation,
    subscriptionsEventAuthority: await v1.findSubscriptionsEventAuthorityPda(),
    period: 0,
    legMask: 1,
    routes: [],
  });
  const r = await w.env.trySend(w.keeper, [ix]);
  expect(errorCode(r.logs)).toBe("RoutedExecutionUnavailable");
});
