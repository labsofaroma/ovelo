/**
 * READ-ONLY mainnet side of the mainnet-fork end to end (M8 B4): genesis check, Jupiter route
 * recording (public build API), and the clone list for solana-test-validator. Every RPC call goes
 * through `readOnly()`, which refuses any method that could change chain state; nothing here signs.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { address, type Address } from "@solana/kit";
import { httpRpc, readOnly } from "./jsonrpc";

export const MAINNET_RPC =
  process.env.OVELO_V1_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** solana-test-validator ships these; cloning them would conflict. */
const BUILTINS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  "SysvarRent111111111111111111111111111111111",
  "SysvarC1ock11111111111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
  "AddressLookupTab1e1111111111111111111111111",
]);

export const mainnet = readOnly(httpRpc(MAINNET_RPC));

type RpcAccount = {
  owner: string;
  executable: boolean;
  data: [string, string];
} | null;

export async function assertMainnet(): Promise<number> {
  if ((await mainnet<string>("getGenesisHash")) !== MAINNET_GENESIS)
    throw new Error("Refusing: the fork is cloned from Solana mainnet only.");
  return mainnet<number>("getSlot", [{ commitment: "confirmed" }]);
}

export async function accountsOf(keys: string[]): Promise<RpcAccount[]> {
  const out: RpcAccount[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const { value } = await mainnet<{ value: RpcAccount[] }>(
      "getMultipleAccounts",
      [keys.slice(i, i + 100), { encoding: "base64", commitment: "confirmed" }],
    );
    out.push(...value);
  }
  return out;
}

export type RecordedBuild = {
  swapInstruction: { programId: string; accounts: { pubkey: string }[] };
  addressesByLookupTableAddress?: Record<string, string[]> | null;
  outAmount: string;
  routePlan: {
    swapInfo: { label: string; inputMint: string; outputMint: string };
    percent?: number;
  }[];
};

/**
 * One Jupiter `/swap/v2/build` per leg with exactly the parameters the keeper sends (taker = the
 * swap authority, destination = the owner's ATA, slippage, no SOL wrapping). Recording only:
 * direct Orca Whirlpool routes, which run on a local fork (proprietary AMMs refuse a stale fork).
 */
export async function recordBuild(leg: {
  outputMint: Address;
  amount: bigint;
  taker: Address;
  destination: Address;
  slippageBps: number;
}): Promise<RecordedBuild> {
  const params = new URLSearchParams({
    inputMint: USDC,
    outputMint: leg.outputMint,
    amount: leg.amount.toString(),
    taker: leg.taker,
    destinationTokenAccount: leg.destination,
    slippageBps: String(leg.slippageBps),
    maxAccounts: "32",
    wrapAndUnwrapSol: "false",
    // The keeper also asks for direct routes; recording additionally pins Orca Whirlpool.
    dexes: "Whirlpool",
    onlyDirectRoutes: "true",
  });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 4_000 * (attempt + 1)));
      continue;
    }
    if (!response.ok)
      throw new Error(`Jupiter build ${response.status} for ${leg.outputMint}`);
    await new Promise((r) => setTimeout(r, 1_300)); // keyless pacing
    return (await response.json()) as RecordedBuild;
  }
  throw new Error("Jupiter build rate limited");
}

/** Everything the recorded builds touch, split into upgradeable programs and plain accounts. */
export async function clonePlan(
  builds: RecordedBuild[],
  extra: string[],
  skip: Set<string>,
) {
  const keys = new Set<string>(extra);
  for (const b of builds) {
    keys.add(b.swapInstruction.programId);
    for (const a of b.swapInstruction.accounts) keys.add(a.pubkey);
    for (const [table, addresses] of Object.entries(
      b.addressesByLookupTableAddress ?? {},
    )) {
      keys.add(table);
      for (const a of addresses) keys.add(a);
    }
  }
  const list = [...keys].filter((k) => !skip.has(k) && !BUILTINS.has(k));
  const fetched = await accountsOf(list);
  const programs: string[] = [];
  const plain: string[] = [];
  list.forEach((key, i) => {
    const account = fetched[i];
    if (!account) return;
    if (account.executable && account.owner === LOADER) programs.push(key);
    else if (!account.executable) plain.push(key);
  });
  return { programs, plain };
}

/** Loopback Jupiter `/swap/v2/build` that serves the recorded builds by (outputMint, amount). */
export async function startJupiterStandIn(builds: Map<string, RecordedBuild>) {
  const state = { requests: 0, misses: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const build = builds.get(
      `${url.searchParams.get("outputMint")}:${url.searchParams.get("amount")}`,
    );
    state.requests += 1;
    res.setHeader("content-type", "application/json");
    if (url.pathname !== "/swap/v2/build" || !build) {
      state.misses += 1;
      res.statusCode = 400;
      res.end(JSON.stringify({ errorCode: "NO_ROUTES_FOUND" }));
      return;
    }
    res.end(JSON.stringify(build));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** `--account` JSON for a classic SPL token account (the owner's forked USDC). */
export function tokenAccountJson(
  pubkey: Address,
  mint: Address,
  owner: Address,
  amount: bigint,
  enc: (a: Address) => Uint8Array,
) {
  const data = new Uint8Array(165);
  data.set(enc(mint), 0);
  data.set(enc(owner), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1; // AccountState::Initialized
  return JSON.stringify({
    pubkey,
    account: {
      lamports: 2_039_280,
      data: [Buffer.from(data).toString("base64"), "base64"],
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      executable: false,
      rentEpoch: 0,
      space: 165,
    },
  });
}

export function walletJson(pubkey: Address, lamports: number) {
  return JSON.stringify({
    pubkey,
    account: {
      lamports,
      data: ["", "base64"],
      owner: "11111111111111111111111111111111",
      executable: false,
      rentEpoch: 0,
      space: 0,
    },
  });
}
