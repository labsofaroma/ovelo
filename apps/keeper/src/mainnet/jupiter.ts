import type { Address } from "@solana/kit";
import { routeFromApi, type JupiterRoute } from "@aroma/guard";
import { validateJupiterExactInInstruction } from "@aroma/guard/jupiter";

/**
 * Jupiter Swap API v2 `/build` for one leg (M8 B5), as M4's trade server calls it: taker = the
 * program's swap authority, `destinationTokenAccount` = the owner's ATA. Every response goes
 * through M4's reviewed ExactIn validator (full Borsh walk, no trailing bytes, amounts, fees,
 * settlement accounts); the routed builder then applies the program's own prefix checks.
 */

export class JupiterUnavailable extends Error {
  constructor(
    readonly kind:
      "rate_limited" | "no_route" | "http" | "unreachable" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "JupiterUnavailable";
  }
}

export type LegBuildRequest = {
  inputMint: Address;
  outputMint: Address;
  inputTokenProgram: Address;
  outputTokenProgram: Address;
  amountIn: bigint;
  swapAuthority: Address;
  source: Address;
  destination: Address;
  slippageBps: number;
};

export type LegBuild = {
  route: JupiterRoute;
  lookupTables: Record<string, string[]>;
  quotedOut: bigint;
};

type BuildResponse = {
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  swapInstruction?: {
    programId: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
  };
  addressesByLookupTableAddress?: Record<string, string[]> | null;
};

/** Jupiter's own slippage guard (M4 accepts 1–300 bps); the program's oracle floor is separate. */
export const jupiterSlippage = (planSlippageBps: number) =>
  Math.max(1, Math.min(300, planSlippageBps));

export function jupiterClient(o: {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}) {
  const get = o.fetch ?? fetch;
  const sleep =
    o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = o.baseUrl.replace(/\/$/, "");
  return {
    async build(leg: LegBuildRequest): Promise<LegBuild> {
      const slippageBps = jupiterSlippage(leg.slippageBps);
      const params = new URLSearchParams({
        inputMint: leg.inputMint,
        outputMint: leg.outputMint,
        amount: leg.amountIn.toString(),
        taker: leg.swapAuthority,
        destinationTokenAccount: leg.destination,
        slippageBps: String(slippageBps),
        maxAccounts: "32",
        wrapAndUnwrapSol: "false",
      });
      let response: Response | null = null;
      for (let attempt = 0; attempt < (o.maxAttempts ?? 4); attempt += 1) {
        try {
          response = await get(`${base}/swap/v2/build?${params}`, {
            headers: o.apiKey ? { "x-api-key": o.apiKey } : {},
            signal: AbortSignal.timeout(15_000),
          });
        } catch (error) {
          throw new JupiterUnavailable(
            "unreachable",
            error instanceof Error ? error.message : String(error),
          );
        }
        if (response.status !== 429) break;
        await sleep(1_000 * 2 ** attempt);
      }
      if (!response) throw new JupiterUnavailable("unreachable", "no response");
      if (response.status === 429)
        throw new JupiterUnavailable("rate_limited", "Jupiter build 429");
      const body = (await response
        .json()
        .catch(() => null)) as BuildResponse | null;
      if (!response.ok) {
        const noRoute =
          JSON.stringify(body ?? {}).includes("NO_ROUTES_FOUND") ||
          response.status === 400;
        throw new JupiterUnavailable(
          noRoute ? "no_route" : "http",
          `Jupiter build ${response.status}`,
        );
      }
      const ix = body?.swapInstruction;
      if (!ix || !body?.outAmount || !body.otherAmountThreshold)
        throw new JupiterUnavailable(
          "invalid",
          "Jupiter build without a swap instruction",
        );
      const data = Uint8Array.from(Buffer.from(ix.data, "base64"));
      try {
        validateJupiterExactInInstruction({
          instruction: { programId: ix.programId, data, accounts: ix.accounts },
          inputAmount: leg.amountIn,
          quotedOutputAmount: BigInt(body.outAmount),
          minimumOutputAmount: BigInt(body.otherAmountThreshold),
          slippageBps,
          settlement: {
            signer: leg.swapAuthority,
            sourceTokenAccount: leg.source,
            destinationTokenAccount: leg.destination,
            inputMint: leg.inputMint,
            outputMint: leg.outputMint,
            inputTokenProgram: leg.inputTokenProgram,
            outputTokenProgram: leg.outputTokenProgram,
          },
        });
      } catch (error) {
        throw new JupiterUnavailable(
          "invalid",
          error instanceof Error ? error.message : String(error),
        );
      }
      return {
        route: routeFromApi(ix),
        lookupTables: body.addressesByLookupTableAddress ?? {},
        quotedOut: BigInt(body.outAmount),
      };
    },
  };
}

export type JupiterClient = ReturnType<typeof jupiterClient>;
