import * as spl from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import { expect } from "vitest";
import { inspectWalletTransaction } from "@/lib/sdk/baskets/mainnet";
import {
  composeBasketV0Chunks,
  type ComposedV0Chunk,
} from "@/lib/sdk/baskets/bundle";
import { fromTokenAmount } from "@/lib/sdk/core/amounts";
import { testJupiterInstruction } from "@/lib/sdk/jupiter/test-fixtures";
import { MAINNET_SOL_MINT } from "@/lib/sdk/trade/types";
import type { RpcAccount } from "./rpc";
import {
  apiInstruction,
  ata,
  createAta,
  inputMint,
  intermediateMint,
  key,
  mintAccount,
  outputMints,
  tokenAccount,
  wallet,
  type ApiInstruction,
} from "./test-fixtures";

export {
  ata,
  createAta,
  intermediateMint,
  key,
  mintAccount,
  type ApiInstruction,
} from "./test-fixtures";
import type { OrderTarget, QuoteDeps, QuoteRequest } from "./quote";

/**
 * TEST-ONLY harness ported from tests/jupiter-intermediate-accounts.test.ts. The prototype loaded
 * basket-order.ts in a VM with mocked modules; v1 takes the same collaborators as an explicit
 * `deps` object, so every fake below maps one-to-one to a prototype module mock.
 */
export type Route = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan?: {
    percent: number;
    swapInfo: { ammKey: string; inputMint: string; outputMint: string };
  }[];
  setupInstructions: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction: ApiInstruction | null;
  otherInstructions: ApiInstruction[];
  addressesByLookupTableAddress: null;
};

export type BuilderOptions = {
  basket?: boolean;
  nativeInput?: boolean;
  transactionVersion?: 0 | 1;
  tokenProgram?: web3.PublicKey;
  routeChange?: (route: Route) => void;
  intermediateAccount?: RpcAccount;
  intermediateBefore?: number;
  intermediateAfter?: number;
  inputDust?: number;
  legInputAmount?: number;
  outputAmount?: number;
  outputAmounts?: readonly number[];
  fundingBalance?: number;
  forceChunks?: boolean;
};

export function builder(options: BuilderOptions = {}) {
  const {
    basket = false,
    nativeInput = false,
    transactionVersion = 0,
    tokenProgram = spl.TOKEN_PROGRAM_ID,
    routeChange = () => {},
    intermediateAccount = mintAccount(tokenProgram),
    intermediateBefore = 0,
    inputDust = 0,
    outputAmount = 1_000_000,
    outputAmounts,
    fundingBalance = 3_000_000,
    forceChunks = false,
  } = options;
  const intermediateAfter = options.intermediateAfter ?? intermediateBefore;
  const mints = basket ? [...outputMints] : outputMints.slice(0, 1);
  const fundingMint = nativeInput ? MAINNET_SOL_MINT : inputMint;
  const fundingAta = ata(fundingMint);
  const legAmount =
    options.legInputAmount ?? (nativeInput ? 1_000_000_000 : 1_000_000);
  const intermediateAta = ata(intermediateMint, tokenProgram);
  const addresses = [
    ...mints.map((mint) => ata(mint)),
    ...(nativeInput ? [] : [fundingAta]),
    wallet,
    intermediateAta,
  ];
  const calls = {
    quotes: 0,
    simulations: 0,
    intermediateMintReads: 0,
    authorizedDebit: null as string | null,
  };
  const walletAccount = (lamports: number): NonNullable<RpcAccount> => ({
    owner: web3.SystemProgram.programId.toBase58(),
    data: ["", "base64"],
    lamports,
    executable: false,
  });

  const jupiterBuild = async (params: URLSearchParams): Promise<Response> => {
    calls.quotes++;
    const outputMint = params.get("outputMint");
    const amount = params.get("amount");
    expect(outputMint && mints.includes(outputMint)).toBe(true);
    expect(amount).toBe(String(legAmount));
    expect(params.get("destinationTokenAccount")).toBe(ata(outputMint!));
    const route: Route = {
      inputMint: fundingMint,
      outputMint: outputMint!,
      inAmount: amount!,
      outAmount: "1000000",
      otherAmountThreshold: "990000",
      swapMode: "ExactIn",
      slippageBps: 100,
      priceImpactPct: "0.001",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: key(),
            inputMint: fundingMint,
            outputMint: intermediateMint,
          },
        },
        {
          percent: 100,
          swapInfo: {
            ammKey: key(),
            inputMint: intermediateMint,
            outputMint: outputMint!,
          },
        },
      ],
      setupInstructions: [createAta(intermediateMint, tokenProgram)],
      cleanupInstruction: null,
      otherInstructions: [],
      addressesByLookupTableAddress: null,
      swapInstruction: testJupiterInstruction({
        signer: wallet,
        source: fundingAta,
        destination: ata(outputMint!),
        inputMint: fundingMint,
        outputMint: outputMint!,
        amount: amount!,
        args: {
          route_plan: [
            {
              swap: { variant: "RaydiumCP" },
              percent: 100,
              bps: 10000,
              input_index: 0,
              output_index: 1,
            },
            {
              swap: { variant: "RaydiumCP" },
              percent: 100,
              bps: 10000,
              input_index: 1,
              output_index: 2,
            },
          ],
        },
      }) as ApiInstruction,
    };
    route.swapInstruction.accounts.push({
      pubkey: intermediateAta,
      isSigner: false,
      isWritable: true,
    });
    if (nativeInput) {
      route.setupInstructions.unshift(
        createAta(fundingMint, spl.TOKEN_PROGRAM_ID),
        apiInstruction(
          web3.SystemProgram.transfer({
            fromPubkey: new web3.PublicKey(wallet),
            toPubkey: new web3.PublicKey(fundingAta),
            lamports: legAmount,
          }),
        ),
        apiInstruction(
          spl.createSyncNativeInstruction(new web3.PublicKey(fundingAta)),
        ),
      );
      route.cleanupInstruction = apiInstruction(
        spl.createCloseAccountInstruction(
          new web3.PublicKey(fundingAta),
          new web3.PublicKey(wallet),
          new web3.PublicKey(wallet),
        ),
      );
    }
    routeChange(route);
    return Response.json(route);
  };

  const rpc = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    if (method === "getBalance") {
      expect(nativeInput).toBe(true);
      expect(params[0]).toBe(wallet);
      return { value: 10_000_000_000 } as T;
    }
    if (method === "getAccountInfo") {
      expect(nativeInput).toBe(false);
      expect(params[0]).toBe(fundingAta);
      return { value: tokenAccount(fundingMint, fundingBalance) } as T;
    }
    expect(method).toBe("getMultipleAccounts");
    const requested = Array.from(params[0] as string[]);
    if (requested[0] === fundingMint) {
      expect(requested).toEqual([fundingMint, ...mints]);
      return { value: requested.map(() => mintAccount()) } as T;
    }
    if (requested[0] === intermediateMint) {
      calls.intermediateMintReads++;
      expect(requested).toEqual([intermediateMint]);
      return { value: [intermediateAccount] } as T;
    }
    expect(requested).toEqual(addresses);
    return {
      value: [
        ...mints.map((mint) => tokenAccount(mint, 0)),
        ...(nativeInput ? [] : [tokenAccount(fundingMint, fundingBalance)]),
        walletAccount(10_000_000_000),
        intermediateBefore === 0
          ? null
          : tokenAccount(intermediateMint, intermediateBefore, tokenProgram),
      ],
    } as T;
  };

  const deps: QuoteDeps = {
    decimals: async (mint) => (mint === MAINNET_SOL_MINT ? 9 : 6),
    rpc,
    selectVersion: async (versions) => {
      expect(Array.from(versions)).toEqual([transactionVersion]);
      return transactionVersion;
    },
    latestBlockhash: async () => ({
      blockhash: key(),
      lastValidBlockHeight: 100,
    }),
    simulate: async (transaction, queried) => {
      calls.simulations++;
      expect(Array.from(queried)).toEqual(addresses);
      const inspected = await inspectWalletTransaction(transaction);
      expect(inspected.message.version).toBe(transactionVersion);
      const executing = mints.filter((mint) =>
        inspected.message.staticAccounts.some(
          (account) => account === ata(mint),
        ),
      );
      return {
        accounts: [
          ...mints.map((mint, index) =>
            tokenAccount(
              mint,
              executing.includes(mint)
                ? (outputAmounts?.[index] ?? outputAmount)
                : 0,
            ),
          ),
          ...(nativeInput
            ? []
            : [
                tokenAccount(
                  fundingMint,
                  fundingBalance - executing.length * legAmount + inputDust,
                ),
              ]),
          walletAccount(
            10_000_000_000 -
              (nativeInput ? executing.length * legAmount : 0) -
              15_000,
          ),
          tokenAccount(intermediateMint, intermediateAfter, tokenProgram),
        ],
        unitsConsumed: 1000,
      };
    },
    jupiterBuild,
    lookupTables: async () => [],
    jitoTip: async () => ({
      lamports: 10_000,
      instruction: web3.SystemProgram.transfer({
        fromPubkey: new web3.PublicKey(wallet),
        toPubkey: new web3.PublicKey(
          "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        ),
        lamports: 10_000,
      }),
    }),
    bundlesEnabled: true,
    authorize: async (input) => {
      calls.authorizedDebit = input.receipt.inAmount;
      return { requestId: "test-request", authorization: "test-authorization" };
    },
    now: () => 1_800_000_000_000,
    ...(forceChunks
      ? {
          composeV0: (params: Parameters<typeof composeBasketV0Chunks>[0]) =>
            params.legs.flatMap((leg) =>
              composeBasketV0Chunks({ ...params, legs: [leg] }),
            ) as ComposedV0Chunk[],
        }
      : {}),
  };

  const target: OrderTarget = basket
    ? {
        kind: "basket",
        basketId: "test-basket",
        legs: mints.map((mint) => ({
          mint,
          symbol: "TEST",
          weightBps: 5000,
        })),
      }
    : {
        kind: "spot",
        basketId: null,
        legs: [{ mint: mints[0]!, symbol: "TEST", weightBps: 10_000 }],
      };
  const request: QuoteRequest = {
    target,
    inputMint: fundingMint,
    amount: fromTokenAmount(
      String(legAmount * mints.length),
      nativeInput ? 9 : 6,
    ),
    taker: wallet,
    slippageBps: 100,
    supportedTransactionVersions: [transactionVersion],
  };
  return { calls, deps, request, addresses };
}
