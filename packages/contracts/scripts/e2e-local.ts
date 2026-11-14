#!/usr/bin/env vite-node
/**
 * Local end to end on solana-test-validator (never devnet or mainnet):
 * pinned Subscriptions + Pyth receiver at genesis → `solana program deploy` of the devnet-mock
 * build → initialize_config → test USD + 3 mock stocks registered with real Pyth feed ids → plan
 * through the v1 builders → period 0 on time, period 1 caught up, period 2 refused and skipped,
 * period 3 → close + revoke in ONE transaction → assertions (lib/e2e-support.ts `report`).
 *
 * Keys are generated for this run under .e2e-local/ (git-ignored). Prices are receiver-owned
 * PriceUpdateV2 accounts loaded at genesis (posting real ones needs a Hermes API key, M7), so the
 * local config allows 1 hour of staleness; LiteSVM tests the 60-second bound.
 */
import fs from "node:fs";
import path from "node:path";
import {
  address,
  generateKeyPairSigner,
  lamports,
  type Address,
  type Instruction,
} from "@solana/kit";
import * as v1 from "../../../apps/web/lib/sdk/guard/v1";
import { assertLocalnet } from "./lib/cluster";
import { CONTRACTS_ROOT, ensureKeypair } from "./lib/keys";
import type { Connection } from "./lib/send";
import { DEVNET_ASSETS, feedBytes } from "./lib/assets";
import { ataAddress } from "./lib/tokens";
import {
  priceAccountJson,
  readClock,
  report,
  waitForClock,
  type Leg,
} from "./lib/e2e-support";
import { deploy, errorCodeOf, startValidator } from "./lib/e2e-validator";
import { provisionLocal, type Stock } from "./lib/e2e-setup";

const WORK = path.join(CONTRACTS_ROOT, ".e2e-local");
const PORT = 18_899;
const SO = path.join(CONTRACTS_ROOT, "target/build/devnet-mock/aroma_guard.so");
const PROGRAM_KEYPAIR = path.join(
  CONTRACTS_ROOT,
  "target/deploy/aroma_guard-keypair.json",
);
const PERIOD = 15n;
const AMOUNT = 30_000_000n; // 30 tUSD
const WEIGHTS = [5_000, 3_000, 2_000];
const PRICES = [23_050_000n, 48_025_000n, 19_012_345n]; // $230.50, $480.25, $190.12345 (expo −5)
const log = (...parts: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...parts);

const computeLimit = (units: number): Instruction => {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return {
    programAddress: address("ComputeBudget111111111111111111111111111111"),
    accounts: [],
    data,
  };
};

async function account(c: Connection, a: Address) {
  const info = (await c.rpc.getAccountInfo(a, { encoding: "base64" }).send())
    .value;
  return info ? Buffer.from(info.data[0], "base64") : null;
}
const tokenAmount = async (c: Connection, ata: Address) =>
  (await account(c, ata))?.readBigUInt64LE(64) ?? 0n;
const readPlan = async (c: Connection, a: Address) =>
  v1.decodePlanAccount((await account(c, a))!);

async function main() {
  for (const f of [SO, PROGRAM_KEYPAIR])
    if (!fs.existsSync(f))
      throw new Error(
        `Missing ${path.relative(CONTRACTS_ROOT, f)}: run \`pnpm --filter @aroma/contracts build\`.`,
      );
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK, "accounts"), { recursive: true });
  const keyFile = (name: string) => path.join(WORK, "keys", `${name}.json`);
  const actors = {
    deployer: await ensureKeypair(keyFile("local-deployer")),
    keeper: await ensureKeypair(keyFile("local-keeper")),
    owner: await ensureKeypair(keyFile("local-owner")),
    treasury: await ensureKeypair(keyFile("local-treasury")),
  };
  const { deployer, keeper, owner, treasury } = actors;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const priceAccounts: Address[] = [];
  const accountArgs: string[] = [];
  for (const [i, asset] of DEVNET_ASSETS.entries()) {
    const addr = (await generateKeyPairSigner()).address;
    const file = path.join(WORK, "accounts", `${asset.symbol}-price.json`);
    fs.writeFileSync(
      file,
      priceAccountJson(addr, {
        feedId: feedBytes(asset.feedId),
        price: PRICES[i]!,
        conf: 5_000n,
        expo: -5,
        publishTime: now,
      }),
    );
    priceAccounts.push(addr);
    accountArgs.push("--account", addr, file);
  }

  log(
    "starting solana-test-validator with the pinned Subscriptions and Pyth receiver binaries",
  );
  const { child, c } = await startValidator(WORK, PORT, accountArgs);
  try {
    await assertLocalnet(c.rpc, c.url);
    for (const who of Object.values(actors))
      await c.rpc
        .requestAirdrop(
          who.address,
          lamports(who === deployer ? 50_000_000_000n : 5_000_000_000n),
        )
        .send();
    await new Promise((r) => setTimeout(r, 2000));

    const d = deploy(
      c.url,
      SO,
      PROGRAM_KEYPAIR,
      keyFile("local-deployer"),
      deployer.address,
      v1.AROMA_GUARD_V1_PROGRAM_ID,
    );
    log(
      "deployed",
      d.programId,
      "| upgrade authority",
      d.authority,
      "(local deployer) | signature",
      d.signature.slice(0, 16) + "…",
    );
    const env = await provisionLocal(c, actors, log);
    const stocks: Stock[] = env.stocks;

    const startsAt = (await readClock(c.rpc)) + 3n;
    await c.send(
      owner,
      await v1.buildCreatePlanInstructions({
        owner,
        fundingMint: env.usd,
        fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
        nonce: 1n,
        fundingAmount: AMOUNT,
        periodSeconds: PERIOD,
        startsAt,
        periods: 4,
        outputs: stocks.map((s, i) => ({
          mint: s.mint,
          weightBps: WEIGHTS[i]!,
          maxSlippageBps: 100,
        })),
        catchUpWindowPeriods: Number(env.config.catchUpWindowPeriods),
        subscriptionAuthorityInitId: null,
      }),
    );
    const planAddress = await v1.findPlanPda(owner.address, env.usd, 1n);
    log(
      "plan created",
      planAddress,
      `| 30 tUSD every ${PERIOD}s × 4 | 50/30/20 | authority + delegation + plan in one transaction`,
    );

    const executeIxs = async (period: number) => [
      computeLimit(600_000),
      await v1.buildExecuteInstallmentInstruction({
        keeper,
        planAddress,
        plan: await readPlan(c, planAddress),
        treasury: treasury.address,
        feeRecipient: null,
        period,
        legMask: 0b111,
        legs: stocks.map((s, i) => ({
          mint: s.mint,
          tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
          priceUpdate: priceAccounts[i]!,
        })),
      }),
    ];
    const atas = stocks.map((s) =>
      ataAddress(owner.address, s.mint, v1.TOKEN_2022_PROGRAM_ID),
    );
    const legs: Leg[] = [];
    const run = async (period: number, atIndex: bigint, label: string) => {
      await waitForClock(c.rpc, startsAt + atIndex * PERIOD + 1n);
      const before = await Promise.all(atas.map((a) => tokenAmount(c, a)));
      const signature = await c.send(keeper, await executeIxs(period));
      const after = await Promise.all(atas.map((a) => tokenAmount(c, a)));
      const split = v1.legAmounts(AMOUNT, WEIGHTS);
      stocks.forEach((s, i) =>
        legs.push({
          period,
          symbol: s.symbol,
          amountIn: split[i]!,
          minted: after[i]! - before[i]!,
          price: PRICES[i]!,
          multiplier: s.multiplier,
        }),
      );
      log(
        label,
        `period ${period} at index ${atIndex}`,
        signature.slice(0, 16) + "…",
        stocks
          .map((s, i) => `${s.symbol} +${after[i]! - before[i]!}`)
          .join(" "),
      );
    };
    await run(0, 0n, "on time   ");
    await run(1, 2n, "catch-up  ");
    await waitForClock(c.rpc, startsAt + 4n * PERIOD + 1n);
    const refused = await c
      .send(keeper, await executeIxs(2))
      .then(() => "accepted", errorCodeOf);
    log(
      "refused   ",
      "period 2 at index 4 →",
      refused,
      "(outside the catch-up window)",
    );
    if (refused !== "UnexpectedPeriod")
      throw new Error(
        `period 2 should be refused with UnexpectedPeriod, got ${refused}`,
      );
    await run(3, 4n, "after skip");
    const plan = await readPlan(c, planAddress);

    const staging = ataAddress(planAddress, env.usd, v1.TOKEN_PROGRAM_ID);
    const balance = async (a: Address) =>
      BigInt((await c.rpc.getBalance(a).send()).value);
    const rentBack = (await balance(planAddress)) + (await balance(staging));
    const ownerBefore = await balance(owner.address);
    const closeIxs = await v1.buildCloseAndRevokeInstructions({
      owner,
      planAddress,
      plan,
      revokeAuthority: true,
    });
    const closeSig = await c.send(owner, closeIxs);
    log(
      "closed    ",
      `close + revoke in ONE transaction (${closeIxs.length} instructions)`,
      closeSig.slice(0, 16) + "…",
    );

    const result = report({
      plan,
      legs,
      treasuryReceived: await tokenAmount(c, env.treasuryUsd),
      expectedTreasury: 3n * AMOUNT,
      planGone: (await account(c, planAddress)) === null,
      stagingGone: (await account(c, staging)) === null,
      delegationGone: (await account(c, plan.recurringDelegation)) === null,
      authorityGone: (await account(c, plan.subscriptionAuthority)) === null,
      ownerDelegateRemoved:
        (await account(c, env.ownerUsd))!.readUInt32LE(72) === 0,
      ownerLamportsDelta: (await balance(owner.address)) - ownerBefore,
      rentBack,
    });
    console.log(
      JSON.stringify(
        result,
        (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
    if (!result.pass) throw new Error("e2e assertions failed");
    log("PASS");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
