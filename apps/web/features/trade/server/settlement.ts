import "server-only";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  basketInputDebitBounds,
  validateBasketInputDebit,
} from "@/lib/sdk/baskets/atomic-swap";
import { MAINNET_SOL_MINT } from "@/lib/sdk/trade/types";
import { AppError } from "@/server/errors";
import type { IntermediateAccount } from "./legs";
import type { Route } from "./route";
import type { RpcAccount, SimulationResult } from "./rpc";

/**
 * Settlement checks on simulated post-state (ported from basket-order.ts). Every built
 * transaction is simulated before it is returned. Each chunk must deliver at least every leg's
 * minimum output to the taker's own token accounts, debit the funding token within the reviewed
 * allowance, never spend a pre-existing intermediate balance, and leave enough SOL for all
 * chunks. Chunks are simulated independently: that proves each route, not bundle atomicity.
 */

const TOKEN_PROGRAMS = [
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
];
const settle = (detail: string) =>
  new AppError("SIMULATION_FAILED", { detail });

/** Raw token amount of an owner's token account; zero when it does not exist. */
export function tokenBalance(
  account: RpcAccount | undefined,
  mint: string,
  owner: string,
): bigint {
  if (!account || account.lamports === 0) return 0n;
  if (!TOKEN_PROGRAMS.includes(account.owner))
    throw settle("Invalid token account in basket simulation.");
  const data = Buffer.from(account.data[0], "base64");
  if (
    data.length < 165 ||
    new PublicKey(data.subarray(0, 32)).toBase58() !== mint ||
    new PublicKey(data.subarray(32, 64)).toBase58() !== owner
  )
    throw settle("Basket assets must settle to your own token accounts.");
  return data.readBigUInt64LE(64);
}

/** The allocation of legs that spend the funding token (a leg already in it stays put). */
export function reviewedInputDebit(
  allocations: readonly { mint: string; amount: bigint }[],
  inputMint: string,
): bigint {
  return allocations
    .filter((allocation) => allocation.mint !== inputMint)
    .reduce((sum, allocation) => sum + allocation.amount, 0n);
}

/** The maximum the wallet may be debited for these legs (what the authorization binds). */
export function maximumDebit(
  allocations: readonly { mint: string; amount: bigint }[],
  inputMint: string,
): bigint {
  const reviewed = reviewedInputDebit(allocations, inputMint);
  return inputMint === MAINNET_SOL_MINT
    ? reviewed
    : basketInputDebitBounds(reviewed).maximum;
}

export async function verifySettlement(input: {
  chunks: readonly { transaction: string; allocationIndexes: number[] }[];
  addresses: readonly string[];
  walletIndex: number;
  before: readonly RpcAccount[];
  allocations: readonly { mint: string; amount: bigint }[];
  routes: readonly (Route | null)[];
  destinations: readonly string[];
  intermediate: ReadonlyMap<string, IntermediateAccount>;
  inputMint: string;
  taker: string;
  simulate: (
    transaction: string,
    addresses: readonly string[],
  ) => Promise<SimulationResult>;
}): Promise<{ unitsConsumed: number }> {
  const { addresses, before, allocations, inputMint, taker } = input;
  const walletBefore = before[input.walletIndex];
  if (!walletBefore || !Number.isSafeInteger(walletBefore.lamports))
    throw settle("The fee payer balance is unavailable.");
  let totalLamports = 0n;
  let totalInputDebit = 0n;
  let unitsConsumed = 0;
  for (const chunk of input.chunks) {
    const simulation = await input.simulate(chunk.transaction, addresses);
    const after = simulation.accounts;
    if (!after || after.length !== addresses.length)
      throw settle("Basket settlement could not be verified by simulation.");
    unitsConsumed += simulation.unitsConsumed ?? 0;
    for (const i of chunk.allocationIndexes) {
      const delivered =
        tokenBalance(after[i], allocations[i]!.mint, taker) -
        tokenBalance(before[i], allocations[i]!.mint, taker);
      if (delivered < BigInt(input.routes[i]!.otherAmountThreshold))
        throw settle(
          "A basket route did not deliver its minimum output to your wallet.",
        );
    }
    const swapAmount = chunk.allocationIndexes.reduce(
      (sum, index) => sum + allocations[index]!.amount,
      0n,
    );
    if (inputMint !== MAINNET_SOL_MINT) {
      const n = input.destinations.length;
      const spent =
        tokenBalance(before[n], inputMint, taker) -
        tokenBalance(after[n], inputMint, taker);
      wrapDebit(() => validateBasketInputDebit(swapAmount, spent));
      totalInputDebit += spent;
    }
    for (const [address, account] of input.intermediate) {
      if (
        !chunk.allocationIndexes.some((i) => account.allocationIndexes.has(i))
      )
        continue;
      const index = addresses.indexOf(address);
      const starting = before[index];
      const ending = after[index];
      if (
        (starting &&
          starting.lamports > 0 &&
          starting.owner !== account.tokenProgram) ||
        (ending &&
          ending.lamports > 0 &&
          ending.owner !== account.tokenProgram) ||
        tokenBalance(ending, account.mint, taker) <
          tokenBalance(starting, account.mint, taker)
      )
        throw settle(
          "A route would spend an existing intermediate token balance.",
        );
    }
    const walletAfter = after[input.walletIndex];
    if (!walletAfter || !Number.isSafeInteger(walletAfter.lamports))
      throw settle("The simulated SOL budget is unavailable.");
    const debit = BigInt(walletBefore.lamports) - BigInt(walletAfter.lamports);
    const minimum = inputMint === MAINNET_SOL_MINT ? swapAmount : 0n;
    totalLamports += debit > minimum ? debit : minimum;
  }
  if (inputMint !== MAINNET_SOL_MINT)
    wrapDebit(() =>
      validateBasketInputDebit(
        reviewedInputDebit(allocations, inputMint),
        totalInputDebit,
      ),
    );
  // Reserve all chunks together, including fees the simulation may not deduct.
  if (
    BigInt(walletBefore.lamports) <
    totalLamports + BigInt(input.chunks.length * 15_000)
  )
    throw new AppError("INSUFFICIENT_FUNDS", {
      detail:
        "Your wallet needs more SOL for all basket transactions, account rent and the reviewed tip.",
    });
  return { unitsConsumed };
}

function wrapDebit(run: () => void): void {
  try {
    run();
  } catch (error) {
    throw settle(error instanceof Error ? error.message : "input debit");
  }
}
