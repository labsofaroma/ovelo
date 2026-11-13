import "server-only";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { z } from "zod";
import {
  classifyJupiterRouteError,
  describeRouteFailure,
} from "@/lib/sdk/baskets/route-health";
import { validateJupiterExactInInstruction } from "@/lib/sdk/jupiter/instruction";
import { MAINNET_SOL_MINT } from "@/lib/sdk/trade/types";
import { AppError } from "@/server/errors";

/**
 * One Jupiter route per leg (ported from basket-order.ts). The provider response is zod-parsed,
 * then bound to the exact integer allocation, the requested slippage, a zero platform fee, the
 * reviewed settlement accounts and the pinned Jupiter ExactIn instruction layout.
 */

export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN_PROGRAMS = [
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
];

const apiInstructionSchema = z.object({
  programId: z.string(),
  accounts: z
    .array(
      z.object({
        pubkey: z.string(),
        isSigner: z.boolean(),
        isWritable: z.boolean(),
      }),
    )
    .max(64),
  data: z.string().max(8192),
});
export type ApiInstruction = z.infer<typeof apiInstructionSchema>;

const rawU64 = z
  .string()
  .regex(/^\d{1,20}$/)
  .refine((v) => /^\d+$/.test(v) && BigInt(v) > 0n && BigInt(v) < 2n ** 64n);

export const routeSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: rawU64,
  otherAmountThreshold: rawU64,
  swapMode: z.string(),
  slippageBps: z.number(),
  priceImpactPct: z.union([z.string(), z.number()]).nullish(),
  routePlan: z.unknown().optional(),
  setupInstructions: z.array(apiInstructionSchema).max(64),
  swapInstruction: apiInstructionSchema,
  cleanupInstruction: apiInstructionSchema.nullish(),
  otherInstructions: z.array(apiInstructionSchema).nullish(),
  addressesByLookupTableAddress: z
    .record(z.string(), z.array(z.string()))
    .nullish(),
  platformFee: z.object({ feeBps: z.number() }).nullish(),
});
export type Route = z.infer<typeof routeSchema>;

const routeError = (detail: string, cause?: unknown) =>
  new AppError("ROUTE_UNAVAILABLE", { detail, cause });

/** Run an sdk validator (which throws plain Errors) and keep its text as the logged detail. */
export function checked<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw routeError(
      error instanceof Error ? error.message : "invalid route",
      error,
    );
  }
}

export function toInstruction(
  value: ApiInstruction,
  taker: string,
): TransactionInstruction {
  return checked(
    () =>
      new TransactionInstruction({
        programId: new PublicKey(value.programId),
        data: Buffer.from(value.data, "base64"),
        keys: value.accounts.map((account) => {
          if (account.isSigner && account.pubkey !== taker)
            throw new Error("Unexpected route signer.");
          return { ...account, pubkey: new PublicKey(account.pubkey) };
        }),
      }),
  );
}

/**
 * Setup and cleanup instructions are an allow-list: create the taker's own ATA, wrap at most the
 * leg's SOL budget into the taker's wSOL account, sync it, or close it back to the taker.
 */
export function setupInstruction(
  value: ApiInstruction,
  taker: string,
  nativeBudget: bigint,
): TransactionInstruction {
  const built = toInstruction(value, taker);
  const keys = built.keys.map((k) => k.pubkey.toBase58());
  const wrapped = getAssociatedTokenAddressSync(
    new PublicKey(MAINNET_SOL_MINT),
    new PublicKey(taker),
  ).toBase58();
  if (built.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    const valid =
      built.data.length === 1 &&
      built.data[0] === 1 &&
      keys.length === 6 &&
      keys[0] === taker &&
      keys[2] === taker &&
      keys[4] === SystemProgram.programId.toBase58() &&
      TOKEN_PROGRAMS.includes(keys[5]!) &&
      getAssociatedTokenAddressSync(
        new PublicKey(keys[3]!),
        new PublicKey(taker),
        false,
        new PublicKey(keys[5]!),
      ).toBase58() === keys[1];
    if (!valid)
      throw routeError("A route tried to create an unexpected token account.");
  } else if (built.programId.equals(SystemProgram.programId)) {
    if (
      keys.length !== 2 ||
      keys[0] !== taker ||
      keys[1] !== wrapped ||
      built.data.length !== 12 ||
      built.data.readUInt32LE(0) !== 2 ||
      built.data.readBigUInt64LE(4) > nativeBudget
    )
      throw routeError("A route requested an unexpected SOL transfer.");
  } else if (built.programId.equals(TOKEN_PROGRAM_ID)) {
    const sync =
      built.data.length === 1 &&
      built.data[0] === 17 &&
      keys.length === 1 &&
      keys[0] === wrapped;
    const close =
      built.data.length === 1 &&
      built.data[0] === 9 &&
      keys.length === 3 &&
      keys[0] === wrapped &&
      keys[1] === taker &&
      keys[2] === taker;
    if (!sync && !close)
      throw routeError(
        "A route requested an unexpected token permission or transfer.",
      );
  } else throw routeError("A route contains unsupported setup instructions.");
  return built;
}

export type LegRequest = {
  inputMint: string;
  outputMint: string;
  outputSymbol: string;
  fundingSymbol: string;
  amount: bigint;
  taker: string;
  slippageBps: number;
  destination: string;
  inputAta: string;
  inputTokenProgram: string;
  outputTokenProgram: string;
};

/** Request, parse and bind one leg's route. */
export async function fetchLegRoute(
  leg: LegRequest,
  build: (params: URLSearchParams) => Promise<Response>,
): Promise<Route> {
  const params = new URLSearchParams({
    inputMint: leg.inputMint,
    outputMint: leg.outputMint,
    amount: leg.amount.toString(),
    taker: leg.taker,
    slippageBps: String(leg.slippageBps),
    maxAccounts: "32",
    destinationTokenAccount: leg.destination,
    wrapAndUnwrapSol: String(
      leg.inputMint === MAINNET_SOL_MINT || leg.outputMint === MAINNET_SOL_MINT,
    ),
  });
  const response = await build(params);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new AppError("TRADING_UNAVAILABLE", {
        detail: "Jupiter rejected the routing credentials",
      });
    if (response.status === 429)
      throw new AppError("RATE_LIMITED", { detail: "Jupiter build 429" });
    if (response.status >= 500)
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        detail: `Jupiter build HTTP ${response.status}`,
      });
    const body = await response.json().catch(() => null);
    const status = classifyJupiterRouteError(response.status, body);
    throw new AppError("ROUTE_UNAVAILABLE", {
      publicMessage: describeRouteFailure(
        status,
        leg.fundingSymbol,
        leg.outputSymbol,
      ),
      detail: `Jupiter build ${response.status} (${status})`,
    });
  }
  const parsed = routeSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw routeError("Jupiter returned a malformed route.", parsed.error);
  const r = parsed.data;
  const out = BigInt(r.outAmount);
  const min = BigInt(r.otherAmountThreshold);
  if (
    r.inputMint !== leg.inputMint ||
    r.outputMint !== leg.outputMint ||
    r.inAmount !== leg.amount.toString() ||
    r.swapMode !== "ExactIn" ||
    r.slippageBps !== leg.slippageBps ||
    min > out ||
    min < (out * BigInt(10_000 - leg.slippageBps)) / 10_000n ||
    (r.platformFee?.feeBps ?? 0) !== 0
  )
    throw routeError(
      "A route did not honor the requested allocation and slippage.",
    );
  if (
    r.swapInstruction.programId !== JUPITER_PROGRAM ||
    (r.otherInstructions?.length ?? 0) > 0
  )
    throw routeError("Unsupported basket router instructions.");
  checked(() =>
    validateJupiterExactInInstruction({
      instruction: {
        ...r.swapInstruction,
        data: Buffer.from(r.swapInstruction.data, "base64"),
      },
      inputAmount: leg.amount,
      quotedOutputAmount: out,
      minimumOutputAmount: min,
      slippageBps: leg.slippageBps,
      settlement: {
        signer: leg.taker,
        sourceTokenAccount: leg.inputAta,
        destinationTokenAccount: leg.destination,
        inputMint: leg.inputMint,
        outputMint: leg.outputMint,
        inputTokenProgram: leg.inputTokenProgram,
        outputTokenProgram: leg.outputTokenProgram,
      },
    }),
  );
  return r;
}
