/**
 * The on-fork phase of `e2e:fork` (M8 B4): config, assets and plan, then the real keeper for each
 * period with assertions (≥ min_out per leg, staging back to its start), then close + revoke.
 * Every transaction goes to the local fork (`c`, genesis checked by the caller).
 */
import fs from "node:fs";
import path from "node:path";
import { address, type Address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  getScaledUiAmountConfig,
  TOKEN_2022_PROGRAM_ID as T22,
  unpackMint,
} from "@solana/spl-token";
import * as v1 from "@aroma/guard";
import {
  createLogger,
  memoryDb,
  memoryRedis,
  parseKeeperEnv,
  runOnce,
} from "@aroma/keeper";
import type { newExportableKeypair } from "./keys";
import { CONTRACTS_ROOT } from "./keys";
import type { connect } from "./send";
import { ataIx } from "./tokens";
import { startFakeHermes, type createTestGuardian } from "./pyth-local";
import { readClock, waitForClock } from "./e2e-support";
import { startJupiterStandIn, USDC, type RecordedBuild } from "./fork-mainnet";

const WORK = path.join(CONTRACTS_ROOT, ".e2e-fork");
export const PERIOD = 3_600n; // the default build's minimum
export const PERIODS = Number(process.env.E2E_FORK_PERIODS ?? 3);
const ISSUER = address("5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq");
const FREEZE = address("JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs");
const NONE = "11111111111111111111111111111111" as Address;
const four = (a: Address) => [a, NONE, NONE, NONE];
const log = (m: string) => process.stdout.write(`[e2e:fork] ${m}\n`);
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === "bigint" ? x.toString() : x,
  );

export type Ctx = {
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

export async function runOnFork(x: Ctx) {
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
