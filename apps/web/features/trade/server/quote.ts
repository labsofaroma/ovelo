import "server-only";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { allocateBasketInput } from "@/lib/sdk/baskets/atomic-swap";
import { BUNDLE_ATOMICITY_WARNING } from "@/lib/sdk/baskets/bundle";
import { fromTokenAmount, toTokenAmount } from "@/lib/sdk/core/amounts";
import { MAINNET_SOL_MINT, MAINNET_USDT_MINT } from "@/lib/sdk/trade/types";
import type { TradeReceipt } from "@/server/auth/trade";
import { AppError } from "@/server/errors";
import { composeExecution, type ComposeDeps } from "./build";
import { feeSummary } from "./fees";
import { buildLegs, verifyIntermediateMints } from "./legs";
import { fetchLegRoute, type Route } from "./route";
import type { MainnetRpc, RpcAccount, SimulationResult } from "./rpc";
import { maximumDebit, tokenBalance, verifySettlement } from "./settlement";

/**
 * Quote → build → simulate → authorize (rewrite of basket-order.ts on lib/sdk). The target is
 * already resolved and checked against the issuer catalog (target.ts). Nothing here signs: the
 * result holds unsigned transactions and an authorization bound to their exact bytes.
 */

export const QUOTE_TTL_MS = 60_000;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type OrderTarget = {
  kind: "spot" | "basket";
  basketId: string | null;
  legs: { mint: string; symbol: string; weightBps: number }[];
};
export type QuoteRequest = {
  target: OrderTarget;
  inputMint: string;
  /** Decimal amount of the funding token, converted with on-chain precision. */
  amount: string;
  taker: string;
  slippageBps: number;
  supportedTransactionVersions: readonly number[];
};
export type QuoteDeps = ComposeDeps & {
  decimals: (mint: string) => Promise<number>;
  rpc: MainnetRpc;
  selectVersion: (versions: readonly number[]) => Promise<0 | 1>;
  latestBlockhash: () => Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
  simulate: (
    transaction: string,
    addresses: readonly string[],
  ) => Promise<SimulationResult>;
  jupiterBuild: (params: URLSearchParams) => Promise<Response>;
  bundlesEnabled: boolean;
  authorize: (input: {
    transactions: string[];
    taker: string;
    expiresAt: number;
    lastValidBlockHeight: number;
    receipt: TradeReceipt;
  }) => Promise<{ requestId: string; authorization: string }>;
  now: () => number;
};

export type QuoteLeg = {
  mint: string;
  symbol: string;
  decimals: number;
  weightBps: number;
  inputAmount: string;
  outAmount: string;
  minimumAmount: string;
  priceImpactPct: string | null;
  hops: number | null;
  tx: number;
};
export type PreparedQuote = {
  requestId: string;
  authorization: string;
  transactions: string[];
  mode: "single" | "bundle";
  transactionVersion: 0 | 1;
  expiresAt: number;
  lastValidBlockHeight: number;
  quote: {
    kind: "spot" | "basket";
    basketId: string | null;
    source: "Jupiter";
    quotedAt: string;
    inputMint: string;
    inputSymbol: string;
    inputDecimals: number;
    inAmount: string;
    maxDebit: string;
    slippageBps: number;
    legs: QuoteLeg[];
    fees: ReturnType<typeof feeSummary>;
    unitsConsumed: number;
    atomicityWarning: string | null;
  };
};

const TOKEN_PROGRAMS = [
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
];

function fundingSymbol(mint: string): string {
  if (mint === USDC) return "USDC";
  if (mint === MAINNET_USDT_MINT) return "USDT";
  if (mint === MAINNET_SOL_MINT) return "SOL";
  return "the funding token";
}

function hops(route: Route | null): number | null {
  return Array.isArray(route?.routePlan) ? route.routePlan.length : null;
}

export async function prepareQuote(
  request: QuoteRequest,
  deps: QuoteDeps,
): Promise<PreparedQuote> {
  const { target, inputMint, taker, slippageBps } = request;
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 300)
    throw new AppError("VALIDATION_FAILED", {
      detail: "slippage out of range",
    });
  const transactionVersion = await deps.selectVersion(
    request.supportedTransactionVersions,
  );
  const mints = [inputMint, ...target.legs.map((leg) => leg.mint)];
  const [decimals, mintAccounts] = await Promise.all([
    Promise.all(mints.map(deps.decimals)),
    deps.rpc<{ value: RpcAccount[] }>("getMultipleAccounts", [
      mints,
      { encoding: "base64", commitment: "confirmed" },
    ]),
  ]);
  const programs = mintAccounts.value.map((account) => {
    if (!account || !TOKEN_PROGRAMS.includes(account.owner))
      throw new AppError("ASSET_UNAVAILABLE", {
        detail: "A basket mint is not an SPL token on mainnet.",
      });
    return new PublicKey(account.owner);
  });
  let inAmount: string;
  try {
    inAmount = toTokenAmount(request.amount, decimals[0]!);
  } catch (cause) {
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: "Enter an amount within the funding token's precision.",
      detail: "amount precision",
      cause,
    });
  }
  let allocations: { mint: string; amount: bigint }[];
  try {
    allocations = allocateBasketInput(
      BigInt(inAmount),
      target.legs.map((leg) => ({ mint: leg.mint, weightBps: leg.weightBps })),
    );
  } catch (cause) {
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: "This amount cannot be split across the order.",
      detail: "allocation",
      cause,
    });
  }
  const owner = new PublicKey(taker);
  const destinations = target.legs.map((leg, i) =>
    getAssociatedTokenAddressSync(
      new PublicKey(leg.mint),
      owner,
      false,
      programs[i + 1],
    ).toBase58(),
  );
  const inputAta = getAssociatedTokenAddressSync(
    new PublicKey(inputMint),
    owner,
    false,
    programs[0],
  ).toBase58();
  const symbol = fundingSymbol(inputMint);

  // Reserve the whole reviewed debit (with its +50 allowance) BEFORE asking for routes.
  const funds =
    inputMint === MAINNET_SOL_MINT
      ? BigInt(
          (
            await deps.rpc<{ value: number }>("getBalance", [
              taker,
              { commitment: "confirmed" },
            ])
          ).value,
        )
      : tokenBalance(
          (
            await deps.rpc<{ value: RpcAccount }>("getAccountInfo", [
              inputAta,
              { encoding: "base64", commitment: "confirmed" },
            ])
          ).value,
          inputMint,
          taker,
        );
  const budget =
    inputMint === MAINNET_SOL_MINT
      ? BigInt(inAmount)
      : maximumDebit(allocations, inputMint);
  if (funds < budget)
    throw new AppError("INSUFFICIENT_FUNDS", {
      detail: `Not enough ${symbol}: this order requires up to ${fromTokenAmount(budget.toString(), decimals[0]!)} ${symbol}, wallet has ${fromTokenAmount(funds.toString(), decimals[0]!)}.`,
    });

  const routes = await Promise.all(
    allocations.map((allocation, i) =>
      allocation.mint === inputMint
        ? Promise.resolve(null)
        : fetchLegRoute(
            {
              inputMint,
              outputMint: allocation.mint,
              outputSymbol: target.legs[i]!.symbol,
              fundingSymbol: symbol,
              amount: allocation.amount,
              taker,
              slippageBps,
              destination: destinations[i]!,
              inputAta,
              inputTokenProgram: programs[0]!.toBase58(),
              outputTokenProgram: programs[i + 1]!.toBase58(),
            },
            deps.jupiterBuild,
          ),
    ),
  );
  const { legs, intermediate } = buildLegs({
    routes,
    allocations,
    destinations,
    programs,
    inputMint,
    taker,
  });
  await verifyIntermediateMints(intermediate, deps.rpc);

  const lifetime = await deps.latestBlockhash();
  const { chunks, tipLamports } = await composeExecution(
    {
      transactionVersion,
      taker,
      lifetime,
      legs,
      routeLookupTables: routes
        .filter((route): route is Route => route !== null)
        .map((route) => route.addressesByLookupTableAddress ?? null),
    },
    deps,
  );
  if (chunks.length > 1 && !deps.bundlesEnabled)
    throw new AppError("BUNDLE_UNAVAILABLE", {
      detail: `${chunks.length} transactions needed; JITO_BLOCK_ENGINE_URL unset`,
    });

  const addresses = [
    ...destinations,
    ...(inputMint !== MAINNET_SOL_MINT ? [inputAta] : []),
    taker,
  ];
  const walletIndex = addresses.length - 1;
  for (const address of intermediate.keys())
    if (!addresses.includes(address)) addresses.push(address);
  const before = await deps.rpc<{ value: RpcAccount[] }>(
    "getMultipleAccounts",
    [addresses, { encoding: "base64", commitment: "confirmed" }],
  );
  if (before.value.length !== addresses.length)
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "Basket starting balances could not be verified.",
    });
  const { unitsConsumed } = await verifySettlement({
    chunks,
    addresses,
    walletIndex,
    before: before.value,
    allocations,
    routes,
    destinations,
    intermediate,
    inputMint,
    taker,
    simulate: deps.simulate,
  });

  const txOf = (index: number) =>
    chunks.findIndex((chunk) => chunk.allocationIndexes.includes(index));
  const quoteLegs: QuoteLeg[] = allocations.map((allocation, i) => {
    const route = routes[i] ?? null;
    return {
      mint: allocation.mint,
      symbol: target.legs[i]!.symbol,
      decimals: decimals[i + 1]!,
      weightBps: target.legs[i]!.weightBps,
      inputAmount: allocation.amount.toString(),
      outAmount: route?.outAmount ?? allocation.amount.toString(),
      minimumAmount:
        route?.otherAmountThreshold ?? allocation.amount.toString(),
      priceImpactPct:
        route?.priceImpactPct === undefined || route.priceImpactPct === null
          ? null
          : String(route.priceImpactPct),
      hops: hops(route),
      tx: Math.max(0, txOf(i)),
    };
  });
  const maxDebit = maximumDebit(allocations, inputMint).toString();
  const now = deps.now();
  const expiresAt = now + QUOTE_TTL_MS;
  const transactions = chunks.map((chunk) => chunk.transaction);
  const { requestId, authorization } = await deps.authorize({
    transactions,
    taker,
    expiresAt,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
    receipt: {
      kind: target.kind,
      basketId: target.basketId,
      inputMint,
      inAmount: maxDebit,
      legs: quoteLegs
        .filter((_, i) => routes[i] !== null)
        .map((leg) => ({
          mint: leg.mint,
          inputAmount: leg.inputAmount,
          outAmount: leg.outAmount,
          minimumAmount: leg.minimumAmount,
          tx: leg.tx,
        })),
    },
  });
  return {
    requestId,
    authorization,
    transactions,
    mode: chunks.length > 1 ? "bundle" : "single",
    transactionVersion,
    expiresAt,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
    quote: {
      kind: target.kind,
      basketId: target.basketId,
      source: "Jupiter",
      quotedAt: new Date(now).toISOString(),
      inputMint,
      inputSymbol: symbol === "the funding token" ? "" : symbol,
      inputDecimals: decimals[0]!,
      inAmount,
      maxDebit,
      slippageBps,
      legs: quoteLegs,
      fees: feeSummary(transactions, tipLamports),
      unitsConsumed,
      atomicityWarning: chunks.length > 1 ? BUNDLE_ATOMICITY_WARNING : null,
    },
  };
}
