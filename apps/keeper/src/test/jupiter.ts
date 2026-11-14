/**
 * Test-only Jupiter Swap API v2 `/build` stand-in. It answers each request with a route_v2
 * instruction shaped exactly like Jupiter's: the real recorded mainnet route data (USDC → AAPLx,
 * Orca Whirlpool) with `in_amount` set to the request, and the fixed account prefix built from
 * the request (taker, its ATAs, mints, programs, destination).
 */
import { address, type Address } from "@solana/kit";
import {
  findAssociatedTokenAddress,
  JUPITER_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@aroma/guard";

const RECORDED = "u2T6zDHErxRAS0wAAAAAAF9cFQAAAAAAZAAAAAAAAQAAAC8AABAnAAE=";
export const QUOTED = 1_399_903n;
const HOP = address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

export type BuildCall = Record<string, string>;

export function fakeJupiterFetch(
  o: {
    status?: number[];
    body?: (params: BuildCall) => unknown;
    calls?: BuildCall[];
    lookupTables?: Record<string, string[]>;
  } = {},
): typeof fetch {
  const statuses = [...(o.status ?? [])];
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(url.searchParams.entries());
    o.calls?.push(params);
    const status = statuses.shift() ?? 200;
    if (status !== 200)
      return new Response(
        JSON.stringify({ errorCode: status === 400 ? "NO_ROUTES_FOUND" : "x" }),
        { status },
      );
    if (o.body) return new Response(JSON.stringify(o.body(params)));
    const taker = params.taker as Address;
    const mint = params.outputMint as Address;
    const inputMint = params.inputMint as Address;
    const data = Buffer.from(RECORDED, "base64");
    data.writeBigUInt64LE(BigInt(params.amount!), 8);
    const accounts = [
      [taker, true, false],
      [
        await findAssociatedTokenAddress(taker, inputMint, TOKEN_PROGRAM_ID),
        false,
        true,
      ],
      [
        await findAssociatedTokenAddress(taker, mint, TOKEN_2022_PROGRAM_ID),
        false,
        true,
      ],
      [inputMint, false, false],
      [mint, false, false],
      [TOKEN_PROGRAM_ID, false, false],
      [TOKEN_2022_PROGRAM_ID, false, false],
      [params.destinationTokenAccount!, false, true],
      [JUPITER_EVENT_AUTHORITY, false, false],
      [JUPITER_V6_PROGRAM_ID, false, false],
      [HOP, false, false],
    ].map(([pubkey, isSigner, isWritable]) => ({
      pubkey,
      isSigner,
      isWritable,
    }));
    return new Response(
      JSON.stringify({
        inAmount: params.amount,
        outAmount: QUOTED.toString(),
        otherAmountThreshold: (QUOTED - (QUOTED * 100n) / 10_000n).toString(),
        slippageBps: 100,
        swapInstruction: {
          programId: JUPITER_V6_PROGRAM_ID,
          accounts,
          data: data.toString("base64"),
        },
        addressesByLookupTableAddress: o.lookupTables ?? null,
      }),
    );
  }) as typeof fetch;
}
