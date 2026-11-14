/**
 * Jupiter `route_v2` instructions as the program accepts them. `checkRouteLeg` mirrors the
 * program's pre-CPI checks (route.rs), so a bad route fails before anything is signed; the
 * program re-checks everything and also checks balances after the swap.
 */
import { AccountRole, address, type Address } from "@solana/kit";
import {
  JUPITER_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  MAX_ROUTE_DATA_LENGTH,
  ROUTE_V2,
  ROUTE_V2_DISCRIMINATOR,
  ROUTE_V2_HEAD_LENGTH,
} from "./constants";

export type RouteAccount = { address: Address; role: AccountRole };
export type JupiterRoute = { accounts: RouteAccount[]; data: Uint8Array };

export type RouteV2Terms = {
  inAmount: bigint;
  quotedOutAmount: bigint;
  slippageBps: number;
  platformFeeBps: number;
  positiveSlippageBps: number;
  routeSteps: number;
};

export class RouteRejected extends Error {
  constructor(readonly reason: string) {
    super(`Jupiter route rejected: ${reason}`);
    this.name = "RouteRejected";
  }
}

export function parseRouteV2(data: Uint8Array): RouteV2Terms {
  if (
    data.length < ROUTE_V2_HEAD_LENGTH ||
    data.length > MAX_ROUTE_DATA_LENGTH ||
    ROUTE_V2_DISCRIMINATOR.some((b, i) => data[i] !== b)
  )
    throw new RouteRejected("not a route_v2 instruction");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const terms = {
    inAmount: view.getBigUint64(8, true),
    quotedOutAmount: view.getBigUint64(16, true),
    slippageBps: view.getUint16(24, true),
    platformFeeBps: view.getUint16(26, true),
    positiveSlippageBps: view.getUint16(28, true),
    routeSteps: view.getUint32(30, true),
  };
  if (terms.routeSteps === 0) throw new RouteRejected("empty route");
  return terms;
}

type ApiInstruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

/**
 * Jupiter Swap API v2 `/build` `swapInstruction` → a route. Signer flags are dropped: the
 * program signs for the swap authority, and nothing else may sign.
 */
export function routeFromApi(ix: ApiInstruction): JupiterRoute {
  if (ix.programId !== JUPITER_V6_PROGRAM_ID)
    throw new RouteRejected("not a Jupiter v6 instruction");
  return {
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    data: Uint8Array.from(Buffer.from(ix.data, "base64")),
  };
}

export type RouteExpectation = {
  swapAuthority: Address;
  source: Address;
  transit: Address;
  fundingMint: Address;
  fundingTokenProgram: Address;
  outputMint: Address;
  outputTokenProgram: Address;
  /** The owner's ATA for the output mint. */
  destination: Address;
  /** `leg_funding − fee`: the exact amount the route must spend. */
  amountIn: bigint;
  /** Accounts the route must never name (plan, config, staging, Subscriptions, …). */
  forbidden: readonly Address[];
};

const writable = (role: AccountRole) =>
  role === AccountRole.WRITABLE || role === AccountRole.WRITABLE_SIGNER;

export function checkRouteLeg(
  route: JupiterRoute,
  e: RouteExpectation,
): RouteV2Terms {
  const at = (i: number) => route.accounts[i]?.address;
  if (route.accounts.length <= ROUTE_V2.prefixLength)
    throw new RouteRejected("no hop accounts");
  if (route.accounts.length > 255) throw new RouteRejected("too many accounts");
  const prefix: [number, Address, string][] = [
    [ROUTE_V2.program, JUPITER_V6_PROGRAM_ID, "program"],
    [ROUTE_V2.eventAuthority, JUPITER_EVENT_AUTHORITY, "event authority"],
    [ROUTE_V2.authority, e.swapAuthority, "authority"],
    [ROUTE_V2.source, e.source, "source"],
    [ROUTE_V2.transit, e.transit, "transit"],
    [ROUTE_V2.sourceMint, e.fundingMint, "source mint"],
    [ROUTE_V2.destinationMint, e.outputMint, "destination mint"],
    [ROUTE_V2.sourceTokenProgram, e.fundingTokenProgram, "source program"],
    [
      ROUTE_V2.destinationTokenProgram,
      e.outputTokenProgram,
      "destination program",
    ],
    [ROUTE_V2.destination, e.destination, "destination"],
  ];
  for (const [index, expected, name] of prefix)
    if (at(index) !== expected) throw new RouteRejected(`wrong ${name}`);
  if (
    route.accounts.some(
      (a) => a.address === e.swapAuthority && writable(a.role),
    )
  )
    throw new RouteRejected("writable authority");
  const banned = new Set(e.forbidden);
  if (route.accounts.some((a) => banned.has(a.address)))
    throw new RouteRejected("forbidden account");
  const terms = parseRouteV2(route.data);
  if (
    terms.inAmount !== e.amountIn ||
    terms.platformFeeBps !== 0 ||
    terms.positiveSlippageBps !== 0
  )
    throw new RouteRejected("amount or fee terms differ from the leg");
  return terms;
}

/** A copy of `route` with its `in_amount` and `quoted_out_amount` re-encoded (tests and tools). */
export function withAmounts(
  route: JupiterRoute,
  inAmount: bigint,
  quotedOutAmount: bigint,
): JupiterRoute {
  parseRouteV2(route.data);
  const data = Uint8Array.from(route.data);
  const view = new DataView(data.buffer);
  view.setBigUint64(8, inAmount, true);
  view.setBigUint64(16, quotedOutAmount, true);
  return { accounts: route.accounts.map((a) => ({ ...a })), data };
}
