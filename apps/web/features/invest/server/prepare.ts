import "server-only";
import { createNoopSigner, type Address } from "@solana/kit";
import {
  buildCloseAndRevokeInstructions,
  buildCreatePlanInstructions,
  findAssociatedTokenAddress,
  planAddresses,
} from "@aroma/guard";
import { authorizePlanTransaction } from "@/server/auth/plan";
import type { TradeKeyring } from "@/server/auth/trade";
import { AppError } from "@/server/errors";
import type { PrepareCreateRequest, PreparedTransaction } from "../schema";
import { basketOptions, buildCatalog, type BasketSource } from "./catalog";
import {
  chainNow,
  readAccount,
  readAssets,
  readConfig,
  readMint,
  readPlan,
  readPlansByOwner,
  readSubscriptionAuthorityInitId,
  readTokenBalance,
} from "./chain";
import type { InvestNetwork, InvestRpc } from "./cluster";
import type { InvestStore } from "./store";
import { closeSummary, createSummary } from "./summary";
import { buildUnsigned, simulate } from "./transactions";
import { assertPlanTerms, resolveOutputs } from "./validate";

/** The devnet and localnet funding token is the test USD created by init-devnet. */
export const FUNDING_SYMBOL = "tUSD";
/** A prepared transaction must be signed and submitted within this time. */
export const AUTHORIZATION_TTL_MS = 90_000;

export type PrepareDeps = {
  network: InvestNetwork;
  rpc: InvestRpc;
  keyring: TradeKeyring;
  store: InvestStore;
  baskets: () => Promise<BasketSource[]>;
  now?: () => number;
};

/** A nonce never used by this owner and mint, closed plans included (receipts key on the PDA). */
async function nextNonce(
  deps: PrepareDeps,
  owner: Address,
  fundingMint: Address,
): Promise<bigint> {
  const [onChain, indexed] = await Promise.all([
    readPlansByOwner(deps.rpc, deps.network.deployment.programId, owner),
    deps.store.indexRows(owner),
  ]);
  let max = 0n;
  for (const { plan } of onChain)
    if (plan.fundingMint === fundingMint && plan.nonce > max) max = plan.nonce;
  for (const row of indexed)
    if (row.fundingMint === fundingMint && BigInt(row.nonce) > max)
      max = BigInt(row.nonce);
  return max + 1n;
}

export async function prepareCreate(
  deps: PrepareDeps,
  request: PrepareCreateRequest,
): Promise<PreparedTransaction> {
  const owner = request.owner as Address;
  const { network, rpc } = deps;
  const fundingMint = network.deployment.fundingMint;
  const [config, assets, sources, mint] = await Promise.all([
    readConfig(rpc),
    readAssets(rpc, network.deployment.programId),
    deps.baskets(),
    readMint(rpc, fundingMint),
  ]);
  const catalog = buildCatalog(assets);
  const { outputs, symbols } = resolveOutputs(
    request.selection,
    catalog,
    basketOptions(sources, catalog),
    config,
  );
  const fundingAmount = BigInt(request.fundingAmount);
  assertPlanTerms({
    cluster: network.cluster,
    config,
    fundingMint,
    fundingAmount,
    periodSeconds: request.periodSeconds,
    periods: request.periods,
    outputs,
  });
  const ownerFunding = await findAssociatedTokenAddress(
    owner,
    fundingMint,
    mint.tokenProgram,
  );
  if (!(await readAccount(rpc, ownerFunding)))
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: `Your wallet has no ${FUNDING_SYMBOL} account yet. Get test tokens from the faucet first.`,
      detail: "owner funding ATA missing",
    });
  const [startsAt, nonce, initId, balance] = await Promise.all([
    chainNow(rpc),
    nextNonce(deps, owner, fundingMint),
    readSubscriptionAuthorityInitId(rpc, owner, fundingMint),
    readTokenBalance(rpc, ownerFunding),
  ]);
  const periodSeconds = BigInt(request.periodSeconds);
  const instructions = await buildCreatePlanInstructions({
    owner: createNoopSigner(owner),
    fundingMint,
    fundingTokenProgram: mint.tokenProgram,
    nonce,
    fundingAmount,
    periodSeconds,
    startsAt,
    periods: request.periods,
    outputs,
    catchUpWindowPeriods: config.catchUpWindowPeriods,
    subscriptionAuthorityInitId: initId,
  });
  const { plan } = await planAddresses({
    owner,
    fundingMint,
    fundingTokenProgram: mint.tokenProgram,
    nonce,
  });
  const unsigned = await buildUnsigned(rpc, owner, instructions);
  const simulation = await simulate(rpc, unsigned.transaction, {
    kind: "plan_create",
    plan,
  });
  const summary = createSummary({
    cluster: network.cluster,
    fundingSymbol: FUNDING_SYMBOL,
    fundingDecimals: mint.decimals,
    fundingAmount,
    periodSeconds,
    periods: request.periods,
    startsAt,
    catchUpWindowPeriods: config.catchUpWindowPeriods,
    allocations: outputs.map((o, i) => ({
      symbol: symbols[i]!,
      weightBps: o.weightBps,
    })),
    balance,
  });
  const expiresAt = (deps.now ?? Date.now)() + AUTHORIZATION_TTL_MS;
  const { authorization } = authorizePlanTransaction(
    {
      kind: "plan_create",
      owner,
      plan,
      cluster: network.cluster,
      genesisHash: network.deployment.genesisHash,
      expiresAt,
      lastValidBlockHeight: unsigned.lastValidBlockHeight.toString(),
      receipt: {
        fundingMint,
        nonce: nonce.toString(),
        installmentRaw: fundingAmount.toString(),
        periods: request.periods,
        outputs: outputs.map((o) => ({ mint: o.mint, weightBps: o.weightBps })),
      },
      transaction: unsigned.transaction,
    },
    deps.keyring,
  );
  return {
    transaction: unsigned.transaction,
    authorization,
    plan,
    expiresAt,
    summary,
    simulation: { unitsConsumed: simulation.unitsConsumed?.toString() ?? null },
  };
}

export async function prepareClose(
  deps: PrepareDeps,
  planAddress: Address,
  ownerInput: string,
): Promise<PreparedTransaction> {
  const owner = ownerInput as Address;
  const { network, rpc } = deps;
  const read = await readPlan(rpc, network.deployment.programId, planAddress);
  if (!read) throw new AppError("NOT_FOUND", { detail: "plan not on chain" });
  if (read.plan.owner !== owner)
    throw new AppError("FORBIDDEN", {
      publicMessage: "Only the wallet that owns this plan can close it.",
      detail: "close by non-owner",
    });
  const plans = await readPlansByOwner(
    rpc,
    network.deployment.programId,
    owner,
  );
  const sameMint = plans.filter(
    (p) => p.plan.fundingMint === read.plan.fundingMint,
  );
  const revokeAuthority = sameMint.length === 1;
  const instructions = await buildCloseAndRevokeInstructions({
    owner: createNoopSigner(owner),
    planAddress,
    plan: read.plan,
    revokeAuthority,
  });
  const unsigned = await buildUnsigned(rpc, owner, instructions);
  const simulation = await simulate(rpc, unsigned.transaction, {
    kind: "plan_close",
    plan: planAddress,
  });
  const expiresAt = (deps.now ?? Date.now)() + AUTHORIZATION_TTL_MS;
  const { authorization } = authorizePlanTransaction(
    {
      kind: "plan_close",
      owner,
      plan: planAddress,
      cluster: network.cluster,
      genesisHash: network.deployment.genesisHash,
      expiresAt,
      lastValidBlockHeight: unsigned.lastValidBlockHeight.toString(),
      receipt: {
        fundingMint: read.plan.fundingMint,
        nonce: read.plan.nonce.toString(),
        installmentRaw: read.plan.fundingAmount.toString(),
        periods: read.plan.periods,
        outputs: read.plan.outputs.map((o) => ({
          mint: o.mint,
          weightBps: o.weightBps,
        })),
      },
      transaction: unsigned.transaction,
    },
    deps.keyring,
  );
  return {
    transaction: unsigned.transaction,
    authorization,
    plan: planAddress,
    expiresAt,
    summary: closeSummary({
      cluster: network.cluster,
      fundingSymbol: FUNDING_SYMBOL,
      executedPeriods: read.plan.executedPeriods,
      skippedPeriods: read.plan.skippedPeriods,
      periods: read.plan.periods,
      revokeAuthority,
    }),
    simulation: { unitsConsumed: simulation.unitsConsumed?.toString() ?? null },
  };
}
