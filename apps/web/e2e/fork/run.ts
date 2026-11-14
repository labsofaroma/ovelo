/**
 * M4 E2E on a LOCAL MAINNET FORK. Nothing here can touch real funds: the fork is a
 * solana-test-validator on 127.0.0.1 seeded with accounts CLONED from mainnet, the wallet is a
 * deterministic test keypair funded only on the fork, and sendTransaction goes to the fork.
 *
 *   pnpm --filter @aroma/web e2e:fork            (record routes, clone, build, run, tear down)
 *
 * 1. Record Jupiter routes (public API, read-only) for the exact legs the server will request.
 * 2. Clone every account those routes touch (programs, pools, lookup tables, mints) into a fresh
 *    validator started at the current mainnet slot (--warp-slot, so cloned ALTs are usable), and
 *    write the test wallet's SOL and USDC balances with --account.
 * 3. Serve the recorded routes from a loopback Jupiter stand-in.
 * 4. Build the app with the E2E wallet bridge into .next-e2e and start it against the fork.
 * 5. Run e2e/trade/*.spec.ts, then stop everything.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { allocateBasketInput } from "../../lib/sdk/baskets/atomic-swap";
import { CANONICAL_BASKET_DEFINITIONS } from "../../lib/sdk/markets/definitions";
import { getMainnetCatalog } from "../../lib/sdk/markets/catalog";
import {
  classify,
  e2eWallet,
  MAINNET_RPC,
  multipleAccounts,
  rpc,
  tokenAccountJson,
  USDC,
  walletJson,
} from "./accounts";

// pnpm runs this from apps/web (the package root).
const WEB = process.cwd();
const WORK = join(WEB, "../../.e2e-fork");
const RPC_PORT = 8899;
const JUPITER_PORT = 4010;
const APP_PORT = 3200;
const STOCK_SYMBOL = process.env.E2E_STOCK ?? "AAPL";
/** E2E_BASKET pins a basket; otherwise the smallest canonical basket fully tradable right now. */
const PINNED_BASKET = process.env.E2E_BASKET;
const STOCK_USDC = 1_000_000n;
const BASKET_USDC = 2_000_000n;

type Leg = { outputMint: string; amount: bigint };
const children: ChildProcess[] = [];
const log = (message: string) =>
  process.stdout.write(`[e2e:fork] ${message}\n`);

async function resolveTargets() {
  const catalog = await getMainnetCatalog({});
  const bySymbol = (symbol: string) =>
    catalog.assets.find(
      (a) =>
        a.issuer === "xstocks" &&
        a.underlyingSymbol === symbol &&
        a.verified &&
        !a.tradingHalted,
    );
  const stock = bySymbol(STOCK_SYMBOL);
  // Issuers pause listings (e.g. XOMx in November 2026); a paused constituent makes a basket
  // unbuyable, so pick one whose constituents are all listed, verified and unpaused today.
  const candidates = [...CANONICAL_BASKET_DEFINITIONS]
    .filter(
      (d) =>
        d.issuer === "xstocks" && (!PINNED_BASKET || d.id === PINNED_BASKET),
    )
    .sort((a, b) => a.symbols.length - b.symbols.length)
    .filter((d) => d.symbols.length >= 2 && d.symbols.every((s) => bySymbol(s)))
    .map((definition) => {
      const members = definition.symbols.map((s) => bySymbol(s)!);
      const count = members.length;
      const allocations = allocateBasketInput(
        BASKET_USDC,
        members.map((m, i) => ({
          mint: m.mint,
          weightBps: Math.floor(10_000 / count) + (i < 10_000 % count ? 1 : 0),
        })),
      );
      return {
        basketId: definition.id,
        legs: allocations.map((a) => ({
          outputMint: a.mint,
          amount: a.amount,
        })) as Leg[],
      };
    });
  if (!stock || !candidates.length)
    throw new Error(
      "E2E targets are not all listed and tradable in the xStocks catalog right now",
    );
  return {
    stock: { mint: stock.mint, symbol: stock.symbol },
    stockLeg: { outputMint: stock.mint, amount: STOCK_USDC } as Leg,
    candidates,
  };
}

async function recordRoutes(legs: Leg[], taker: PublicKey) {
  const mints = [...new Set(legs.map((l) => l.outputMint))];
  const owners = await multipleAccounts(MAINNET_RPC, mints);
  const programOf = new Map(
    mints.map((m, i) => [
      m,
      owners[i]?.owner === TOKEN_2022_PROGRAM_ID.toBase58()
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID,
    ]),
  );
  const routes: Record<string, unknown> = {};
  for (const leg of legs) {
    const params = new URLSearchParams({
      inputMint: USDC,
      outputMint: leg.outputMint,
      amount: leg.amount.toString(),
      taker: taker.toBase58(),
      slippageBps: "100",
      maxAccounts: "32",
      destinationTokenAccount: getAssociatedTokenAddressSync(
        new PublicKey(leg.outputMint),
        taker,
        false,
        programOf.get(leg.outputMint),
      ).toBase58(),
      wrapAndUnwrapSol: "false",
      // Recording only (the server never sends this): the local solana-test-validator (Agave
      // 3.1.10) cannot execute Manifest's current program binary even with mainnet's feature
      // set ("Program is not deployed"). A basket with a Manifest-only leg is skipped instead.
      excludeDexes: "Manifest",
    });
    let response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`);
    // Keyless Jupiter rate-limits quickly: back off and retry instead of skipping the basket.
    for (let attempt = 1; response.status === 429 && attempt <= 6; attempt++) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      response = await fetch(`https://api.jup.ag/swap/v2/build?${params}`);
    }
    if (!response.ok)
      throw new Error(`Jupiter build ${response.status} for ${leg.outputMint}`);
    routes[`${leg.outputMint}:${leg.amount}`] = await response.json();
    await new Promise((r) => setTimeout(r, 1300)); // keyless pacing
  }
  return routes;
}

type ApiIx = { programId: string; accounts: { pubkey: string }[] };
function routeAccounts(route: Record<string, unknown>): string[] {
  const ixs = [
    ...((route.setupInstructions as ApiIx[]) ?? []),
    route.swapInstruction as ApiIx,
    ...(route.cleanupInstruction ? [route.cleanupInstruction as ApiIx] : []),
  ];
  const keys = new Set<string>();
  for (const ix of ixs) {
    keys.add(ix.programId);
    for (const a of ix.accounts) keys.add(a.pubkey);
  }
  for (const [table, addresses] of Object.entries(
    (route.addressesByLookupTableAddress as Record<string, string[]>) ?? {},
  )) {
    keys.add(table);
    for (const address of addresses) keys.add(address);
  }
  return [...keys];
}

async function startFork(routes: Record<string, unknown>) {
  const taker = e2eWallet().publicKey;
  const keys = new Set<string>([USDC]);
  for (const route of Object.values(routes))
    for (const key of routeAccounts(route as Record<string, unknown>))
      keys.add(key);
  for (const key of keys) {
    // Never clone the wallet's own accounts: they are created or written below.
    if (key === taker.toBase58()) keys.delete(key);
  }
  const list = [...keys];
  const accounts = await multipleAccounts(MAINNET_RPC, list);
  const { programs, plain } = classify(list, accounts);
  // Skip the wallet's ATAs (they do not exist on mainnet, or must start empty on the fork).
  const ownAtas = new Set(
    list.filter((_, i) => {
      const data = accounts[i]?.data?.[0];
      if (!data) return false;
      const bytes = Buffer.from(data, "base64");
      return (
        bytes.length >= 64 &&
        new PublicKey(bytes.subarray(32, 64)).equals(taker)
      );
    }),
  );
  const funded = tokenAccountJson(USDC, taker, 100_000_000n);
  mkdirSync(join(WORK, "accounts"), { recursive: true });
  writeFileSync(join(WORK, "accounts/usdc.json"), JSON.stringify(funded.json));
  writeFileSync(
    join(WORK, "accounts/wallet.json"),
    JSON.stringify(walletJson(taker, 20_000_000_000)),
  );
  const slot = await rpc<number>(MAINNET_RPC, "getSlot", [
    { commitment: "confirmed" },
  ]);
  const args = [
    "--reset",
    "--quiet",
    "--ledger",
    join(WORK, "ledger"),
    "--rpc-port",
    String(RPC_PORT),
    "--url",
    MAINNET_RPC,
    // Mainnet's feature set, so the fork runs every program the routes use exactly as mainnet
    // does (without it, newer program binaries such as Manifest's report "not deployed").
    "--clone-feature-set",
    "--warp-slot",
    String(slot + 64),
    "--account",
    taker.toBase58(),
    join(WORK, "accounts/wallet.json"),
    "--account",
    funded.address,
    join(WORK, "accounts/usdc.json"),
    ...programs.flatMap((p) => ["--clone-upgradeable-program", p]),
    ...plain
      .filter((k) => k !== funded.address && !ownAtas.has(k))
      .flatMap((k) => ["--maybe-clone", k]),
  ];
  log(
    `starting fork: ${programs.length} programs, ${plain.length} accounts cloned from mainnet at slot ${slot}`,
  );
  const validator = spawn("solana-test-validator", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(validator);
  validator.stderr?.on("data", (d) => process.stderr.write(`[validator] ${d}`));
  const local = `http://127.0.0.1:${RPC_PORT}`;
  for (let i = 0; i < 240; i++) {
    try {
      const genesis = await rpc<string>(local, "getGenesisHash");
      await rpc<number>(local, "getSlot");
      return genesis;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("the local fork did not start");
}

function startJupiterStandIn(routes: Record<string, unknown>) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${JUPITER_PORT}`);
    const route =
      routes[
        `${url.searchParams.get("outputMint")}:${url.searchParams.get("amount")}`
      ];
    response.setHeader("content-type", "application/json");
    if (url.pathname !== "/swap/v2/build" || !route) {
      response.statusCode = 400;
      response.end(JSON.stringify({ errorCode: "NO_ROUTES_FOUND" }));
      return;
    }
    response.end(JSON.stringify(route));
  });
  server.listen(JUPITER_PORT, "127.0.0.1");
  return server;
}

function run(
  command: string,
  args: string[],
  env: Record<string, string>,
  background = false,
) {
  const child = spawn(command, args, {
    cwd: WEB,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (background) children.push(child);
  return background
    ? Promise.resolve(0)
    : new Promise<number>((resolve) =>
        child.on("exit", (code) => resolve(code ?? 1)),
      );
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const taker = e2eWallet().publicKey;
  const { stock, stockLeg, candidates } = await resolveTargets();
  const routes = await recordRoutes([stockLeg], taker);
  // The first candidate basket whose every leg has a route the local fork can execute.
  let basketId = "";
  let legs: Leg[] = [stockLeg];
  for (const candidate of candidates) {
    try {
      Object.assign(routes, await recordRoutes(candidate.legs, taker));
      basketId = candidate.basketId;
      legs = [stockLeg, ...candidate.legs];
      break;
    } catch (error) {
      log(`basket ${candidate.basketId} skipped: ${(error as Error).message}`);
    }
  }
  if (!basketId)
    throw new Error("no basket has fork-executable routes right now");
  log(
    `targets: ${stock.symbol} and basket ${basketId} (${legs.length - 1} legs); test wallet ${taker.toBase58()}`,
  );
  writeFileSync(join(WORK, "routes.json"), JSON.stringify(routes, null, 2));
  const genesis = await startFork(routes);
  log(`fork genesis ${genesis}`);
  const stand = startJupiterStandIn(routes);
  // Placeholder values from .env.example satisfy boot validation; they connect to nothing.
  const placeholders = Object.fromEntries(
    readFileSync(join(WEB, ".env.example"), "utf8")
      .split("\n")
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
      .filter((m): m is RegExpMatchArray => Boolean(m && m[2]))
      .map((m) => [m[1]!, m[2]!]),
  );
  const appEnv: Record<string, string> = {
    ...placeholders,
    AROMA_V1_ENABLED: "true",
    AROMA_V1_ALLOW_TEST_SWITCHES: "true",
    AROMA_V1_TEST_FORK_GENESIS: genesis,
    AROMA_V1_TEST_JUPITER_URL: `http://127.0.0.1:${JUPITER_PORT}`,
    SOLANA_RPC_URL: `http://127.0.0.1:${RPC_PORT}`,
    AROMA_TRUST_PROXY: "true",
    NEXT_PUBLIC_AROMA_E2E_WALLET: "true",
    AROMA_NEXT_DIST_DIR: ".next-e2e",
  };
  if (process.env.E2E_SKIP_BUILD !== "1") {
    // `next build` rewrites tsconfig.json and next-env.d.ts to point at its distDir; restore
    // them so an E2E run never leaves .next-e2e references in tracked files.
    const tracked = ["tsconfig.json", "next-env.d.ts"].map((file) => ({
      path: join(WEB, file),
      text: readFileSync(join(WEB, file), "utf8"),
    }));
    const built = await run("npx", ["next", "build"], appEnv);
    for (const file of tracked) writeFileSync(file.path, file.text);
    if (built !== 0) throw new Error("E2E build failed");
  }
  await run("npx", ["next", "start", "-p", String(APP_PORT)], appEnv, true);
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${APP_PORT}/v1/privacy`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const code = await run(
    "npx",
    [
      "playwright",
      "test",
      "-c",
      "e2e/trade.config.ts",
      ...process.argv.slice(2),
    ],
    {
      E2E_BASE_URL: `http://127.0.0.1:${APP_PORT}`,
      E2E_STOCK_SYMBOL: stock.symbol,
      E2E_BASKET_ID: basketId,
    },
  );
  stand.close();
  process.exitCode = code;
}

function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(stop);
