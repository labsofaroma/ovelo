import type { Address, Instruction } from "@solana/kit";
import {
  buildExecuteInstallmentRoutedInstruction,
  findAssociatedTokenAddress,
  installmentEvents,
  installmentRecord,
  MAINNET_MAX_PRICE_AGE_S,
  routedLegAmounts,
  swapAccountsFor,
  swapAuthorityAccountInstructions,
  type Plan,
  type RoutedLegInput,
} from "@ovelo/guard";
import {
  freshUpdates,
  legInfos,
  missingAccounts,
  pricePlan,
  type LegInfo,
} from "../build";
import type { BatchRunner, ExecuteDeps } from "../execute";
import {
  MAX_TRANSACTION_BYTES,
  PermanentError,
  sendInstructions,
  transactionBytes,
  type SendOptions,
} from "../send";
import { jitoTipInstruction } from "./jito";
import { JupiterUnavailable, type JupiterClient } from "./jupiter";
import { verifiedLookupTables } from "./lookup-tables";

/**
 * One mainnet leg batch (M8 B5). Order: [owner, treasury and swap-authority accounts if missing]
 * → a fresh Jupiter route per leg → fresh, fully verified Pyth posts (no older than
 * MAINNET_MAX_PRICE_AGE_S when the execute lands, M8 decision 1) → one `execute_installment_routed`
 * per batch, compressed with Jupiter's verified lookup tables, simulated, then sent (RPC or Jito)
 * → receipts → price cleanup. A batch that does not fit one transaction runs one leg per
 * transaction (the program's leg bitmap allows any split).
 */

export type MainnetRunner = {
  jupiter: JupiterClient;
  jito?: { submit: NonNullable<SendOptions["submit"]>; tipLamports: bigint };
};

async function swapSetup(
  deps: ExecuteDeps,
  plan: Plan,
  legs: readonly LegInfo[],
): Promise<Instruction[]> {
  const wanted = [
    { mint: plan.fundingMint, tokenProgram: plan.fundingTokenProgram },
    ...legs.map((l) => ({ mint: l.mint, tokenProgram: l.tokenProgram })),
  ];
  const all = await swapAuthorityAccountInstructions(deps.keeper, wanted);
  const addresses = all.map((ix) => ix.accounts![1]!.address);
  const { value } = await deps.rpc
    .getMultipleAccounts(addresses, {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();
  return all.filter((_, i) => !value[i]);
}

async function legRoutes(
  m: MainnetRunner,
  deps: ExecuteDeps,
  plan: Plan,
  legs: readonly LegInfo[],
): Promise<{
  inputs: Omit<RoutedLegInput, "priceUpdate">[];
  tables: Record<string, string[]>[];
}> {
  const inputs = [];
  const tables = [];
  for (const leg of legs) {
    const swap = await swapAccountsFor({
      fundingMint: plan.fundingMint,
      fundingTokenProgram: plan.fundingTokenProgram,
      outputMint: leg.mint,
      outputTokenProgram: leg.tokenProgram,
    });
    let built;
    try {
      built = await m.jupiter.build({
        inputMint: plan.fundingMint,
        outputMint: leg.mint,
        inputTokenProgram: plan.fundingTokenProgram,
        outputTokenProgram: leg.tokenProgram,
        amountIn: routedLegAmounts(plan, leg.leg, deps.config.protocolFeeBps)
          .amountIn,
        swapAuthority: swap.authority,
        source: swap.source,
        destination: await findAssociatedTokenAddress(
          plan.owner,
          leg.mint,
          leg.tokenProgram,
        ),
        slippageBps: plan.outputs[leg.leg]!.maxSlippageBps,
      });
    } catch (error) {
      if (error instanceof JupiterUnavailable)
        throw new PermanentError(
          `Jupiter route for leg ${leg.leg}: ${error.message}`,
          [],
          "ROUTE_UNAVAILABLE",
        );
      throw error;
    }
    inputs.push({
      mint: leg.mint,
      tokenProgram: leg.tokenProgram,
      route: built.route,
    });
    tables.push(built.lookupTables);
  }
  return { inputs, tables };
}

export function mainnetBatchRunner(m: MainnetRunner): BatchRunner {
  return async (deps, address, plan, period, legMask, legIndexes, now) => {
    const send = {
      ...deps.send,
      rpc: deps.rpc,
      keeper: deps.keeper,
      log: deps.log,
    };
    const legs = await legInfos(deps.rpc, plan, legIndexes);
    const signatures: string[] = [];
    const setup = [
      ...(await missingAccounts(
        deps.rpc,
        deps.keeper,
        plan,
        deps.config,
        legs,
      )),
      ...(await swapSetup(deps, plan, legs)),
    ];
    if (setup.length)
      signatures.push(
        (await sendInstructions(send, setup, "token accounts")).signature,
      );
    const { inputs, tables } = await legRoutes(m, deps, plan, legs);
    const lookupTables = await verifiedLookupTables(deps.rpc, tables);
    const maxAge = Math.min(
      deps.config.maxOracleStalenessS,
      MAINNET_MAX_PRICE_AGE_S,
    );
    const updates = await freshUpdates(
      deps.hermes,
      [...new Set(legs.map((l) => l.feedId))],
      now,
      maxAge,
    );
    const prices = await pricePlan(deps.rpc, deps.keeper, updates);
    for (const [i, group] of prices.transactions.entries())
      signatures.push(
        (
          await sendInstructions(
            send,
            group,
            `price ${i + 1}/${prices.transactions.length}`,
          )
        ).signature,
      );
    const withPrice = inputs.map((input, k) => {
      const priceUpdate = prices.priceUpdateFor.get(
        legs[k]!.feedId.toLowerCase(),
      );
      if (!priceUpdate)
        throw new Error(`no posted price for ${legs[k]!.feedId}`);
      return { ...input, priceUpdate };
    });
    const executeFor = async (mask: number, legInputs: RoutedLegInput[]) => [
      await buildExecuteInstallmentRoutedInstruction({
        keeper: deps.keeper,
        planAddress: address,
        plan,
        treasury: deps.config.treasury,
        feeRecipient:
          deps.config.protocolFeeBps > 0 ? deps.config.feeRecipient : null,
        protocolFeeBps: deps.config.protocolFeeBps,
        period,
        legMask: mask,
        legs: legInputs,
      }),
      ...(m.jito ? [jitoTipInstruction(deps.keeper, m.jito.tipLamports)] : []),
    ];
    const options: SendOptions = { lookupTables, submit: m.jito?.submit };
    let batches: { mask: number; legs: RoutedLegInput[] }[] = [
      { mask: legMask, legs: withPrice },
    ];
    if (
      withPrice.length > 1 &&
      (await transactionBytes(
        send,
        await executeFor(legMask, withPrice),
        options,
      )) > MAX_TRANSACTION_BYTES
    )
      batches = withPrice.map((leg, k) => ({
        mask: 1 << legs[k]!.leg,
        legs: [leg],
      }));
    for (const batch of batches) {
      const sent = await sendInstructions(
        send,
        await executeFor(batch.mask, batch.legs),
        "execute_installment_routed",
        options,
      );
      signatures.push(sent.signature);
      const event = installmentEvents(sent.logs).find(
        (e) => e.plan === address && e.period === period,
      );
      if (!event)
        throw new PermanentError(
          "execute_installment_routed confirmed without its InstallmentExecuted event",
          sent.logs,
          "EVENT_MISSING",
        );
      const record = installmentRecord(event);
      await deps.db.insertInstallment({
        signature: sent.signature,
        wallet: plan.owner,
        amountIn: record.amountIn.toString(),
        mintIn: plan.fundingMint,
        legs: record.legs,
        slot: sent.slot,
        blockTime:
          sent.blockTime === null
            ? null
            : new Date(Number(sent.blockTime) * 1000),
        planPda: address as Address,
        period,
      });
    }
    try {
      signatures.push(
        (await sendInstructions(send, prices.cleanup, "cleanup")).signature,
      );
    } catch (err) {
      deps.log.warn(
        { err, plan: address, period },
        "price account cleanup failed; rent stays until the next cleanup",
      );
    }
    return signatures;
  };
}
