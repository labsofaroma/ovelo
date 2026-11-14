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
import { PublicKey } from "@solana/web3.js";
import {
  getScaledUiAmountConfig,
  TOKEN_2022_PROGRAM_ID as T22,
  unpackMint,
} from "@solana/spl-token";
import * as v1 from "@aroma/guard";
import { getEquityFeedId } from "@aroma/guard/pyth";
import {
  createLogger,
  memoryDb,
  memoryRedis,
  parseKeeperEnv,
  runOnce,
} from "@aroma/keeper";
import { CONTRACTS_ROOT, newExportableKeypair } from "./lib/keys";
import { connect } from "./lib/send";
import { ataIx } from "./lib/tokens";
import {
  createTestGuardian,
  localPythAccounts,
  startFakeHermes,
} from "./lib/pyth-local";
import { readClock, waitForClock } from "./lib/e2e-support";
import {
  assertMainnet,
  clonePlan,
  MAINNET_GENESIS,
  MAINNET_RPC,
  recordBuild,
  startJupiterStandIn,
  tokenAccountJson,
  USDC,
  walletJson,
  type RecordedBuild,
} from "./lib/fork-mainnet";

const WORK = path.join(CONTRACTS_ROOT, ".e2e-fork");
const PORT = 8979;
const SO = path.join(CONTRACTS_ROOT, "target/build/mainnet/aroma_guard.so");
const PERIOD = 3_600n; // the default build's minimum
const PERIODS = Number(process.env.E2E_FORK_PERIODS ?? 3);
const LEGS = [
  { symbol: "AAPL", xstock: "AAPLx", weight: 5_000, amount: 5_000_000n },
  { symbol: "TSLA", xstock: "TSLAx", weight: 3_000, amount: 3_000_000n },
  { symbol: "NVDA", xstock: "NVDAx", weight: 2_000, amount: 2_000_000n },
];
const ISSUER = address("5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq");
const FREEZE = address("JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs");
const NONE = "11111111111111111111111111111111" as Address;
const SUBSCRIPTIONS = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const WORMHOLE = "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ";
const log = (m: string) => process.stdout.write(`[e2e:fork] ${m}\n`);
const enc = getAddressEncoder();
const four = (a: Address) => [a, NONE, NONE, NONE];
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === "bigint" ? x.toString() : x,
  );

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
    const build = await recordBuild({
      outputMint: l.mint,
      amount: l.amount,
      taker: swap,
      destination: l.ownerAta,
      slippageBps: 100,
    });
    builds.set(`${l.mint}:${l.amount}`, build);
    log(
      `route ${l.xstock}: ${build.routePlan.map((s) => s.swapInfo.label).join(" → ")}, quoted ${build.outAmount}`,
    );
  }

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

type Ctx = {
  c: ReturnType<typeof connect>;
  genesis: string;
  admin: Awaited<ReturnType<typeof newExportableKeypair>>;
  keeper: Awaited<ReturnType<typeof newExportableKeypair>>;
  owner: Awaited<ReturnType<typeof newExportableKeypair>>;
  legs: {
    symbol: string;
    xstock: string;
    weight: number;
    amount: bigint;
    mint: Address;
    feedId: string;
    ownerAta: Address;
  }[];
  builds: Map<string, RecordedBuild>;
  guardian: ReturnType<typeof createTestGuardian>;
  source: { chain: number; emitter: Address };
  stop: (() => unknown)[];
};

async function runOnFork(x: Ctx) {
  const { c, admin, keeper, owner, legs } = x;
  const params = {
    admin: admin.signer.address,
    keeperAuthority: keeper.signer.address,
    allowedFundingMints: four(USDC),
    maxSlippageBps: 300,
    maxOracleStalenessS: 60,
    catchUpWindowPeriods: 1,
    protocolFeeBps: 0,
    feeRecipient: NONE,
    maxInstallmentAmount: 500_000_000n,
    maxConfidenceBps: 200,
    treasury: admin.signer.address,
    allowedFreezeAuthorities: four(FREEZE),
    allowedPermanentDelegates: four(ISSUER),
    allowedTransferHookPrograms: four(NONE),
  };
  await c.send(admin.signer, [
    await v1.buildInitializeConfigInstruction({
      authority: admin.signer,
      params,
    }),
  ]);
  await c.send(admin.signer, [
    ataIx(admin.signer, admin.signer.address, USDC, v1.TOKEN_PROGRAM_ID),
  ]);
  for (const l of legs)
    await c.send(admin.signer, [
      await v1.buildRegisterAssetInstruction({
        admin: admin.signer,
        mint: l.mint,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        pythFeedId: Uint8Array.from(Buffer.from(l.feedId.slice(2), "hex")),
      }),
    ]);
  log(
    `config initialized (keeper-only, USDC, xStocks issuer keys allow-listed); registered ${legs.map((l) => l.xstock).join(", ")}`,
  );
  const startsAt = await readClock(c.rpc);
  const plan = await v1.findPlanPda(owner.signer.address, USDC, 1n);
  await c.send(
    owner.signer,
    await v1.buildCreatePlanInstructions({
      owner: owner.signer,
      fundingMint: USDC,
      fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
      nonce: 1n,
      fundingAmount: 10_000_000n,
      periodSeconds: PERIOD,
      startsAt,
      periods: PERIODS,
      outputs: legs.map((l) => ({
        mint: l.mint,
        weightBps: l.weight,
        maxSlippageBps: 100,
      })),
      catchUpWindowPeriods: 1,
      subscriptionAuthorityInitId: null,
    }),
  );
  log(
    `plan ${plan}: 10 USDC per hour for ${PERIODS} periods (owner ${owner.signer.address})`,
  );

  // Fresh guardian-signed prices at the market price the routes were quoted at (+0.3 %).
  const prices = new Map<
    string,
    { price: bigint; conf: bigint; expo: number }
  >();
  for (const l of legs) {
    const data = (
      await c.rpc.getAccountInfo(l.mint, { encoding: "base64" }).send()
    ).value!;
    const mint = unpackMint(
      new PublicKey(l.mint),
      {
        data: Buffer.from(data.data[0], "base64"),
        owner: T22,
        lamports: 0,
        executable: false,
      },
      T22,
    );
    const multiplier = getScaledUiAmountConfig(mint)?.multiplier ?? 1;
    const shares =
      (Number(x.builds.get(`${l.mint}:${l.amount}`)!.outAmount) / 1e8) *
      multiplier;
    const price = BigInt(
      Math.round((Number(l.amount) / 1e6 / shares) * 1.003 * 1e8),
    );
    prices.set(l.feedId.toLowerCase(), {
      price,
      conf: price / 10_000n,
      expo: -8,
    });
  }
  // Publish times follow the fork's Clock (what the program checks), not the wall clock.
  const offset = Number(await readClock(c.rpc)) - Math.floor(Date.now() / 1000);
  log(`fork clock is ${offset} s from the wall clock`);
  const hermes = await startFakeHermes({
    now: () => Math.floor(Date.now() / 1000) + offset,
    guardians: [x.guardian],
    guardianSetIndex: 0,
    source: x.source,
    prices,
  });
  const jupiter = await startJupiterStandIn(x.builds);
  x.stop.push(
    () => hermes.close(),
    () => jupiter.close(),
  );
  const env = parseKeeperEnv({
    NODE_ENV: "development",
    LOG_LEVEL: "warn",
    KEEPER_CLUSTER: "mainnet-fork",
    KEEPER_ALLOW_FORK: "true",
    KEEPER_FORK_GENESIS: x.genesis,
    KEEPER_RPC_URL: c.url,
    KEEPER_MAINNET_KEYPAIR: JSON.stringify(keeper.secret),
    HERMES_URL: hermes.url,
    KEEPER_JUPITER_URL: jupiter.url,
    QSTASH_CURRENT_SIGNING_KEY: "local-fork-current-signing",
    QSTASH_NEXT_SIGNING_KEY: "local-fork-next-signing-key",
    UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
    UPSTASH_REDIS_REST_TOKEN: "unused",
    DATABASE_URL: "postgres://unused@127.0.0.1/unused",
  });
  const db = memoryDb();
  const redis = memoryRedis();
  const deps = {
    env,
    db,
    redis,
    log: createLogger("warn"),
    alerts: { cluster: "mainnet-fork", format: "slack" as const },
  };
  const staging = await v1.findAssociatedTokenAddress(
    plan,
    USDC,
    v1.TOKEN_PROGRAM_ID,
  );
  const amount = async (a: Address) =>
    BigInt((await c.rpc.getTokenAccountBalance(a).send()).value.amount);
  const stagingStart = await amount(staging);
  const results = [];
  for (let period = 0; period < PERIODS; period += 1) {
    await waitForClock(c.rpc, startsAt + BigInt(period) * PERIOD + 2n);
    const before = await Promise.all(
      legs.map((l) => amount(l.ownerAta).catch(() => 0n)),
    );
    const report = await runOnce(deps);
    const outcome = report.outcomes.find((o) => o.plan === plan);
    if (outcome?.status !== "executed" || outcome.period !== period)
      throw new Error(`period ${period}: ${json(report.outcomes)}`);
    const receipts = db.receipts.filter((r) => r.period === period);
    const after = await Promise.all(legs.map((l) => amount(l.ownerAta)));
    const legRecords = receipts.flatMap(
      (r) => r.legs as { mint: string; amountOut: string; minOut: string }[],
    );
    for (const leg of legRecords)
      if (BigInt(leg.amountOut) < BigInt(leg.minOut))
        throw new Error(`period ${period}: ${leg.mint} below min_out`);
    if ((await amount(staging)) !== stagingStart)
      throw new Error(`period ${period}: staging not restored`);
    results.push({
      period,
      executeTransactions: receipts.length,
      signatures: receipts.map((r) => r.signature),
      legs: legs.map((l, i) => {
        const rec = legRecords.find((r) => r.mint === l.mint)!;
        return {
          stock: l.xstock,
          amountOut: rec.amountOut,
          minOut: rec.minOut,
          received: (after[i]! - before[i]!).toString(),
        };
      }),
      staging: (await amount(staging)).toString(),
    });
    log(
      `period ${period}: ${receipts.length} execute transactions; ${json(results.at(-1)!.legs)}`,
    );
    if (period + 1 < PERIODS)
      log(
        `waiting for period ${period + 1} (${PERIOD} s periods; the clock cannot be warped)`,
      );
  }
  const p = v1.decodePlanAccount(
    Uint8Array.from(
      Buffer.from(
        (await c.rpc.getAccountInfo(plan, { encoding: "base64" }).send()).value!
          .data[0],
        "base64",
      ),
    ),
  );
  await c.send(
    owner.signer,
    await v1.buildCloseAndRevokeInstructions({
      owner: owner.signer,
      planAddress: plan,
      plan: p,
      revokeAuthority: true,
    }),
  );
  const gone = await Promise.all(
    [plan, staging, p.recurringDelegation, p.subscriptionAuthority].map(
      async (a) => (await c.rpc.getAccountInfo(a).send()).value === null,
    ),
  );
  if (!gone.every(Boolean))
    throw new Error(`close + revoke left accounts: ${json(gone)}`);
  log(
    `closed + revoked in one transaction: plan, staging, delegation and authority gone`,
  );
  fs.writeFileSync(
    path.join(WORK, "report.json"),
    json({
      genesis: x.genesis,
      plan,
      periods: results,
      executedPeriods: p.executedPeriods,
      jupiterRequests: jupiter.state.requests,
      hermesRequests: hermes.requests,
    }) + "\n",
  );
  log(
    `report: ${json({ executedPeriods: p.executedPeriods, skippedPeriods: p.skippedPeriods, jupiter: jupiter.state, hermesRequests: hermes.requests })}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
