/**
 * READ-ONLY. Records the mainnet fixtures for the LiteSVM Jupiter suite (M8 B3):
 *   tests/fixtures/jupiter-mainnet-routes.json  Jupiter `route_v2` builds (Whirlpool, direct) for
 *                                               three catalog xStocks, with the real swap-authority
 *                                               PDA as taker, and a snapshot of every account
 *                                               they touch (public chain data)
 *   tests/fixtures/mainnet-programs.json        SHA-256 pins of the mainnet program binaries
 *   target/test-programs/mainnet/*.so           the binaries (git-ignored; re-fetched and verified
 *                                               by `pnpm test:fixtures:mainnet`)
 * Only getGenesisHash / getMultipleAccounts / getAccountInfo / getSlot / getBlockTime and the
 * public Jupiter build API. Never signs, never sends a transaction, never loads a wallet.
 *
 *   pnpm --filter @ovelo/contracts fixtures:jupiter
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { address, getAddressDecoder, type Address } from "@solana/kit";
import * as v1 from "@ovelo/guard";

const root = path.resolve(import.meta.dirname, "..");
const RPC =
  process.env.OVELO_V1_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
/** A stand-in destination owner; the tests put their owner's ATA at route index 7. */
const PLACEHOLDER_OWNER = address("11111111111111111111111111111111");
/** Leg amounts of the test plan (10 USDC: 50 / 30 / 20 %). */
const LEGS = [
  { symbol: "AAPLx", amount: 5_000_000n },
  { symbol: "TSLAx", amount: 3_000_000n },
  { symbol: "NVDAx", amount: 2_000_000n },
] as const;

type RpcAccount = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, string];
} | null;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const body = (await response.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (body.error)
      throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
    return body.result as T;
  }
  throw new Error(`${method}: rate limited`);
}

async function accounts(keys: string[]): Promise<RpcAccount[]> {
  const out: RpcAccount[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const { value } = await rpc<{ value: RpcAccount[] }>(
      "getMultipleAccounts",
      [keys.slice(i, i + 100), { encoding: "base64", commitment: "confirmed" }],
    );
    out.push(...value);
  }
  return out;
}

type ApiIx = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

async function build(
  outputMint: Address,
  amount: bigint,
  taker: Address,
  destination: Address,
) {
  const params = new URLSearchParams({
    inputMint: USDC,
    outputMint,
    amount: amount.toString(),
    taker,
    destinationTokenAccount: destination,
    slippageBps: "100",
    dexes: "Whirlpool",
    onlyDirectRoutes: "true",
    maxAccounts: "32",
    wrapAndUnwrapSol: "false",
  });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    if (!response.ok)
      throw new Error(`Jupiter build ${response.status} for ${outputMint}`);
    return (await response.json()) as {
      swapInstruction: ApiIx;
      outAmount: string;
      routePlan: { swapInfo: { label: string } }[];
    };
  }
  throw new Error("Jupiter build rate limited");
}

async function programBinary(programId: string) {
  const program = (
    await rpc<{ value: RpcAccount }>("getAccountInfo", [
      programId,
      { encoding: "base64" },
    ])
  ).value;
  if (!program?.executable || program.owner !== LOADER) return null;
  const programData = getAddressDecoder().decode(
    Buffer.from(program.data[0], "base64").subarray(4, 36),
  );
  const data = Buffer.from(
    (
      await rpc<{ value: RpcAccount }>("getAccountInfo", [
        programData,
        { encoding: "base64" },
      ])
    ).value!.data[0],
    "base64",
  );
  const binary = data.subarray(45);
  return {
    programId,
    programData,
    lastDeploySlot: data.readBigUInt64LE(4).toString(),
    bytes: binary.length,
    sha256: crypto.createHash("sha256").update(binary).digest("hex"),
    binary,
  };
}

async function main() {
  if ((await rpc<string>("getGenesisHash")) !== MAINNET_GENESIS)
    throw new Error("Refusing: this recorder reads Solana mainnet only.");
  const mints = JSON.parse(
    fs.readFileSync(
      path.join(root, "tests/fixtures/xstocks-mainnet-mints.json"),
      "utf8",
    ),
  ) as {
    mints: { symbol: string; mint: string }[];
  };
  const swapAuthority = await v1.findSwapAuthorityPda();
  const routes = [];
  const keys = new Set<string>();
  for (const leg of LEGS) {
    const mint = address(
      mints.mints.find((m) => m.symbol === leg.symbol)!.mint,
    );
    const swap = await v1.swapAccountsFor({
      fundingMint: USDC,
      fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
      outputMint: mint,
      outputTokenProgram: v1.TOKEN_2022_PROGRAM_ID,
    });
    const placeholder = await v1.findAssociatedTokenAddress(
      PLACEHOLDER_OWNER,
      mint,
      v1.TOKEN_2022_PROGRAM_ID,
    );
    const built = await build(mint, leg.amount, swapAuthority, placeholder);
    const route = v1.routeFromApi(built.swapInstruction);
    const terms = v1.checkRouteLeg(route, {
      swapAuthority,
      source: swap.source,
      transit: swap.transit,
      fundingMint: USDC,
      fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
      outputMint: mint,
      outputTokenProgram: v1.TOKEN_2022_PROGRAM_ID,
      destination: placeholder,
      amountIn: leg.amount,
      forbidden: [],
    });
    // The tests create the swap authority's accounts and the owner's; never snapshot them.
    const own = new Set<string>([
      swapAuthority,
      swap.source,
      swap.transit,
      placeholder,
    ]);
    for (const a of route.accounts)
      if (!own.has(a.address)) keys.add(a.address);
    routes.push({
      symbol: leg.symbol,
      mint,
      amountIn: leg.amount.toString(),
      quotedOutAmount: terms.quotedOutAmount.toString(),
      labels: built.routePlan.map((s) => s.swapInfo.label),
      accounts: route.accounts.map((a) => ({
        address: a.address,
        writable: a.role === 1,
      })),
      data: Buffer.from(route.data).toString("base64"),
    });
    await new Promise((r) => setTimeout(r, 1500)); // keyless pacing
  }
  const slot = await rpc<number>("getSlot", [{ commitment: "confirmed" }]);
  const blockTime = await rpc<number>("getBlockTime", [slot]);
  const list = [...keys];
  const fetched = await accounts(list);
  const snapshot: Record<
    string,
    { owner: string; lamports: number; data: string }
  > = {};
  const programs: Record<
    string,
    Omit<NonNullable<Awaited<ReturnType<typeof programBinary>>>, "binary">
  > = {};
  const outDir = path.join(root, "target/test-programs/mainnet");
  fs.mkdirSync(outDir, { recursive: true });
  for (const [i, key] of list.entries()) {
    const account = fetched[i];
    if (!account) continue;
    if (account.executable) {
      const program = await programBinary(key);
      if (!program) continue; // native or loader-v2 programs ship with LiteSVM
      const { binary, ...pin } = program;
      fs.writeFileSync(path.join(outDir, `${key}.so`), binary);
      programs[key] = pin;
      continue;
    }
    snapshot[key] = {
      owner: account.owner,
      lamports: account.lamports,
      data: account.data[0],
    };
  }
  for (const id of [v1.TOKEN_2022_PROGRAM_ID]) {
    const program = await programBinary(id);
    if (program) {
      const { binary, ...pin } = program;
      fs.writeFileSync(path.join(outDir, `${id}.so`), binary);
      programs[id] = pin;
    }
  }
  const readAt = new Date().toISOString();
  const header = {
    source: RPC,
    genesisHash: MAINNET_GENESIS,
    slot,
    blockTime,
    readAt,
  };
  fs.writeFileSync(
    path.join(root, "tests/fixtures/jupiter-mainnet-routes.json"),
    JSON.stringify(
      {
        comment:
          "Read-only mainnet data for the LiteSVM Jupiter suite (scripts/record-jupiter-mainnet.ts): Jupiter Swap API v2 route_v2 builds with the Ovelo Guard v1 swap-authority PDA as taker, and every account they touch at the slot below. Route index 7 (destination) is a placeholder the tests replace with their owner's ATA. Public chain data; no key material.",
        ...header,
        swapAuthority,
        routes,
        accounts: snapshot,
      },
      null,
      1,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "tests/fixtures/mainnet-programs.json"),
    JSON.stringify(
      {
        comment:
          "SHA-256 pins of mainnet program binaries for the LiteSVM Jupiter suite (ProgramData ELF, read-only). `pnpm test:fixtures:mainnet` re-downloads and verifies them; an upstream redeploy fails the fetch until the routes are re-recorded and reviewed.",
        ...header,
        programs,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        slot,
        blockTime,
        routes: routes.map((r) => [
          r.symbol,
          r.labels,
          r.accounts.length,
          r.quotedOutAmount,
        ]),
        accounts: Object.keys(snapshot).length,
        programs: Object.fromEntries(
          Object.entries(programs).map(([k, p]) => [k, p.sha256]),
        ),
      },
      null,
      1,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
