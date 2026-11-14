/**
 * M8 B4: Aroma Guard v1 DEFAULT (mainnet) build on a LOCAL MAINNET FORK, driven by the real keeper
 * in mainnet-fork mode. Nothing here can send a mainnet transaction: mainnet is only read through
 * `readOnly()` (genesis, accounts, slot) and the public Jupiter build API; every transaction goes
 * to solana-test-validator on 127.0.0.1, whose genesis is checked to be neither mainnet's nor
 * devnet's before anything is signed. Every key is generated in memory for this run.
 *
 *   pnpm --filter @aroma/contracts e2e:fork        (E2E_FORK_PERIODS=1 for a quick run)
 *
 * 1. Record Jupiter routes (route_v2, Orca Whirlpool) for AAPLx 50 %, TSLAx 30 %, NVDAx 20 % with
 *    the swap-authority PDA as taker and the test owner's ATAs as destinations.
 * 2. Fork: clone Jupiter, Whirlpool, Subscriptions, Pyth receiver and Wormhole (mainnet binaries),
 *    the pools, USDC and the xStocks mints (--clone-feature-set); load the default build at its
 *    program ID with a local upgrade authority; a test guardian replaces Wormhole's guardian set
 *    (Hermes needs the owner's API key); the owner holds forked USDC.
 * 3. initialize_config (USDC, issuer keys on the Token-2022 allow-lists, keeper-only), register
 *    the three real xStocks, create a plan of 10 USDC per hour for 3 periods.
 * 4. Each period: the keeper's runOnce (reconcile, Jupiter routes from a loopback stand-in serving
 *    the recordings, fresh guardian-signed prices, 2 legs + 1 leg = two execute transactions).
 * 5. Assert every leg delivered ≥ min_out and staging returned to its start; close + revoke.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { address, getAddressEncoder, type Address } from "@solana/kit";
import * as v1 from "@aroma/guard";
import { getEquityFeedId } from "@aroma/guard/pyth";
import { CONTRACTS_ROOT, newExportableKeypair } from "./lib/keys";
import { runOnFork } from "./lib/fork-run";
import { connect } from "./lib/send";
import { createTestGuardian, localPythAccounts } from "./lib/pyth-local";
import {
  assertMainnet,
  clonePlan,
  MAINNET_GENESIS,
  MAINNET_RPC,
  recordBuild,
  tokenAccountJson,
  USDC,
  walletJson,
  type RecordedBuild,
} from "./lib/fork-mainnet";

const WORK = path.join(CONTRACTS_ROOT, ".e2e-fork");
const PORT = 8979;
const SO = path.join(CONTRACTS_ROOT, "target/build/mainnet/aroma_guard.so");
const LEGS = [
  { symbol: "AAPL", xstock: "AAPLx", weight: 5_000, amount: 5_000_000n },
  { symbol: "TSLA", xstock: "TSLAx", weight: 3_000, amount: 3_000_000n },
  { symbol: "NVDA", xstock: "NVDAx", weight: 2_000, amount: 2_000_000n },
];
const SUBSCRIPTIONS = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const WORMHOLE = "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ";
const log = (m: string) => process.stdout.write(`[e2e:fork] ${m}\n`);
const enc = getAddressEncoder();

async function main() {
  if (!fs.existsSync(SO))
    throw new Error("Run `pnpm --filter @aroma/contracts build` first.");
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK, "accounts"), { recursive: true });
  const slot = await assertMainnet();
  const mints = JSON.parse(
    fs.readFileSync(
      path.join(CONTRACTS_ROOT, "tests/fixtures/xstocks-mainnet-mints.json"),
      "utf8",
    ),
  ) as {
    mints: { symbol: string; mint: Address }[];
  };
  const [admin, keeper, owner] = [
    await newExportableKeypair(),
    await newExportableKeypair(),
    await newExportableKeypair(),
  ];
  const swap = await v1.findSwapAuthorityPda();
  const legs = await Promise.all(
    LEGS.map(async (l) => {
      const mint = mints.mints.find((m) => m.symbol === l.xstock)!.mint;
      return {
        ...l,
        mint,
        feedId: getEquityFeedId(l.symbol)!,
        ownerAta: await v1.findAssociatedTokenAddress(
          owner.signer.address,
          mint,
          v1.TOKEN_2022_PROGRAM_ID,
        ),
      };
    }),
  );

  // 1. Routes (read-only Jupiter API), keyed the way the keeper asks for them.
  const builds = new Map<string, RecordedBuild>();
  for (const l of legs) {
    // The program executes direct routes only (see the keeper's jupiter.ts); re-record otherwise.
    let build: RecordedBuild | null = null;
    for (let attempt = 0; attempt < 6 && !build; attempt += 1) {
      const candidate = await recordBuild({
        outputMint: l.mint,
        amount: l.amount,
        taker: swap,
        destination: l.ownerAta,
        slippageBps: 100,
      });
      const direct = candidate.routePlan.every(
        (s) =>
          s.swapInfo.inputMint === USDC && s.swapInfo.outputMint === l.mint,
      );
      if (direct) build = candidate;
      else
        log(
          `route ${l.xstock}: Jupiter returned a hop through another mint; recording again`,
        );
    }
    if (!build) throw new Error(`no direct route for ${l.xstock} right now`);
    builds.set(`${l.mint}:${l.amount}`, build);
    log(
      `route ${l.xstock}: ${build.routePlan.map((s) => `${s.swapInfo.label} ${s.percent ?? 100}%`).join(" + ")}, quoted ${build.outAmount}`,
    );
  }
  fs.writeFileSync(
    path.join(WORK, "routes.json"),
    JSON.stringify(Object.fromEntries(builds), null, 2),
  );

  // 2. The fork.
  const guardian = createTestGuardian();
  const source = {
    chain: 26,
    emitter: address("6R92oFT6UiP2xWZBjTbwAkHzFCLy5BhWnNh6m83ndhZR"),
  };
  const pyth = await localPythAccounts({
    guardians: [guardian],
    guardianSetIndex: 0,
    source,
    governance: admin.signer.address,
    creationTime: Math.floor(Date.now() / 1000) - 60,
  });
  const ownerUsdc = await v1.findAssociatedTokenAddress(
    owner.signer.address,
    USDC,
    v1.TOKEN_PROGRAM_ID,
  );
  const written = new Map<string, string>([
    ...pyth.map((p) => [p.address as string, p.json] as const),
    [owner.signer.address, walletJson(owner.signer.address, 10_000_000_000)],
    [keeper.signer.address, walletJson(keeper.signer.address, 50_000_000_000)],
    [admin.signer.address, walletJson(admin.signer.address, 50_000_000_000)],
    [
      ownerUsdc,
      tokenAccountJson(
        ownerUsdc,
        USDC,
        owner.signer.address,
        100_000_000n,
        (a) => Uint8Array.from(enc.encode(a)),
      ),
    ],
  ]);
  const skip = new Set<string>([
    swap,
    owner.signer.address,
    ...legs.map((l) => l.ownerAta),
    ...written.keys(),
  ]);
  for (const l of legs) {
    const s = await v1.swapAccountsFor({
      fundingMint: USDC,
      fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
      outputMint: l.mint,
      outputTokenProgram: v1.TOKEN_2022_PROGRAM_ID,
    });
    skip.add(s.source).add(s.transit);
  }
  const { programs, plain } = await clonePlan(
    [...builds.values()],
    [
      USDC,
      ...legs.map((l) => l.mint),
      SUBSCRIPTIONS,
      v1.PYTH_RECEIVER_PROGRAM_ID,
      WORMHOLE,
    ],
    skip,
  );
  const accountArgs = [...written.entries()].flatMap(([key, body]) => {
    const file = path.join(WORK, "accounts", `${key}.json`);
    fs.writeFileSync(file, body);
    return ["--account", key, file];
  });
  log(
    `fork: ${programs.length} programs, ${plain.length} accounts cloned from mainnet at slot ${slot}`,
  );
  const validator = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger",
      path.join(WORK, "ledger"),
      "--rpc-port",
      String(PORT),
      "--faucet-port",
      String(PORT + 1001),
      "--url",
      MAINNET_RPC,
      "--clone-feature-set",
      "--warp-slot",
      String(slot + 64),
      "--upgradeable-program",
      v1.V1_PROGRAM_ID,
      SO,
      admin.signer.address,
      ...accountArgs,
      ...programs.flatMap((p) => ["--clone-upgradeable-program", p]),
      ...plain.flatMap((k) => ["--maybe-clone", k]),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  validator.stderr?.on("data", (d) => process.stderr.write(`[validator] ${d}`));
  const stop: (() => unknown)[] = [() => validator.kill("SIGTERM")];
  try {
    const c = connect(`http://127.0.0.1:${PORT}`);
    for (let i = 0; ; i += 1) {
      try {
        if ((await c.rpc.getHealth().send()) === "ok") break;
      } catch {
        /* starting */
      }
      if (i > 240) throw new Error("the fork did not start");
      await new Promise((r) => setTimeout(r, 1000));
    }
    const genesis = await c.rpc.getGenesisHash().send();
    if (genesis === MAINNET_GENESIS || genesis === v1.DEVNET_GENESIS_HASH)
      throw new Error("refusing: not a local fork");
    log(`fork genesis ${genesis} (local; not mainnet, not devnet)`);
    await runOnFork({
      c,
      genesis,
      admin,
      keeper,
      owner,
      legs,
      builds,
      guardian,
      source,
      stop,
    });
    log("PASS (local mainnet fork; no mainnet transaction was sent)");
  } finally {
    for (const s of stop.reverse()) await s();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
