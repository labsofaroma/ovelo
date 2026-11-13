import "server-only";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { BasketSwapLeg } from "@/lib/sdk/baskets/bundle";
import {
  getJupiterIntermediateMints,
  validateJupiterIntermediateMint,
} from "@/lib/sdk/jupiter/route-plan";
import { MAINNET_SOL_MINT } from "@/lib/sdk/trade/types";
import { AppError } from "@/server/errors";
import { checked, setupInstruction, toInstruction, type Route } from "./route";
import type { MainnetRpc, RpcAccount } from "./rpc";

/**
 * Turn validated routes into executable legs (ported from basket-order.ts). Every leg is
 * independently executable: it creates its own destination ATA, and any extra token account a
 * route creates must be an owner ATA for a mint on that route's verified swap path that the swap
 * actually writes to. Those intermediate mints are re-read from mainnet before composition.
 */

export type IntermediateAccount = {
  mint: string;
  tokenProgram: string;
  allocationIndexes: Set<number>;
};

const routeError = (detail: string) =>
  new AppError("ROUTE_UNAVAILABLE", { detail });

export function buildLegs(input: {
  routes: readonly (Route | null)[];
  allocations: readonly { mint: string; amount: bigint }[];
  destinations: readonly string[];
  programs: readonly PublicKey[];
  inputMint: string;
  taker: string;
}): { legs: BasketSwapLeg[]; intermediate: Map<string, IntermediateAccount> } {
  const { routes, allocations, destinations, programs, inputMint, taker } =
    input;
  const legs: BasketSwapLeg[] = [];
  const intermediate = new Map<string, IntermediateAccount>();
  routes.forEach((route, i) => {
    if (!route) return;
    const allocation = allocations[i]!;
    const instructions: TransactionInstruction[] = [
      // A destination override asks Jupiter not to create the ATA, so create it ourselves.
      createAssociatedTokenAccountIdempotentInstruction(
        new PublicKey(taker),
        new PublicKey(destinations[i]!),
        new PublicKey(taker),
        new PublicKey(allocation.mint),
        programs[i + 1]!,
      ),
    ];
    const setupKeys = new Set<string>([destinations[i]!]);
    let pathMints: ReadonlySet<string> | undefined;
    const writableSwapAccounts = new Set(
      route.swapInstruction.accounts
        .filter((account) => account.isWritable && !account.isSigner)
        .map((account) => account.pubkey),
    );
    let funded = 0n;
    for (const setup of route.setupInstructions) {
      const instruction = setupInstruction(
        setup,
        taker,
        inputMint === MAINNET_SOL_MINT ? allocation.amount : 0n,
      );
      if (instruction.programId.equals(SystemProgram.programId)) {
        funded += instruction.data.readBigUInt64LE(4);
        if (funded > allocation.amount)
          throw routeError("The route exceeds its SOL allocation.");
      }
      if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        const key = instruction.keys[1]!.pubkey.toBase58();
        const mint = instruction.keys[3]!.pubkey.toBase58();
        const tokenProgram = instruction.keys[5]!.pubkey.toBase58();
        const endpointProgram =
          mint === inputMint
            ? programs[0]!.toBase58()
            : mint === allocation.mint
              ? programs[i + 1]!.toBase58()
              : undefined;
        if (endpointProgram) {
          if (tokenProgram !== endpointProgram)
            throw routeError(
              "A route token account uses the wrong token program.",
            );
        } else {
          pathMints ??= checked(() =>
            getJupiterIntermediateMints(
              route.routePlan,
              inputMint,
              allocation.mint,
            ),
          );
          if (!pathMints.has(mint) || !writableSwapAccounts.has(key))
            throw routeError(
              "A route requested a token account outside its verified swap path.",
            );
          const existing = intermediate.get(key);
          if (existing) existing.allocationIndexes.add(i);
          else
            intermediate.set(key, {
              mint,
              tokenProgram,
              allocationIndexes: new Set([i]),
            });
          if (intermediate.size > 64)
            throw routeError(
              "The route requires too many intermediate token accounts.",
            );
        }
        if (setupKeys.has(key)) continue;
        setupKeys.add(key);
      }
      instructions.push(instruction);
    }
    instructions.push(toInstruction(route.swapInstruction, taker));
    if (route.cleanupInstruction)
      instructions.push(setupInstruction(route.cleanupInstruction, taker, 0n));
    legs.push({ allocationIndex: i, instructions });
  });
  if (!legs.length)
    throw new AppError("BAD_REQUEST", {
      publicMessage: "This order does not require a swap.",
      detail: "no legs",
    });
  return { legs, intermediate };
}

/** Route metadata is untrusted: confirm each intermediate mint and its program on mainnet. */
export async function verifyIntermediateMints(
  intermediate: ReadonlyMap<string, IntermediateAccount>,
  rpc: MainnetRpc,
): Promise<void> {
  const mints = [...new Set([...intermediate.values()].map((a) => a.mint))];
  if (!mints.length) return;
  const result = await rpc<{ value: RpcAccount[] }>("getMultipleAccounts", [
    mints,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (result.value.length !== mints.length)
    throw routeError("Intermediate token mints could not be verified.");
  const programs = new Map(
    mints.map((mint, index) => {
      const account = result.value[index];
      return [
        mint,
        checked(() =>
          validateJupiterIntermediateMint(
            mint,
            account
              ? {
                  owner: account.owner,
                  data: Buffer.from(account.data[0], "base64"),
                  executable: account.executable,
                }
              : null,
          ),
        ),
      ] as const;
    }),
  );
  for (const account of intermediate.values())
    if (programs.get(account.mint) !== account.tokenProgram)
      throw routeError(
        "An intermediate token account uses the wrong token program.",
      );
}
