#!/usr/bin/env vite-node
/**
 * LOCAL-ONLY chain for the M7 invest E2E (apps/web/e2e/invest/run.ts starts and stops it).
 *
 * A fresh solana-test-validator with the pinned Subscriptions, Pyth receiver and Wormhole
 * binaries, and Aroma Guard v1 (devnet-mock build) loaded at its real program ID with a RUNTIME
 * upgrade authority (no program keypair is needed or read). Every key is generated in this
 * process and written only to the git-ignored work folder for the runner. Then:
 * - test USD whose mint authority is a runtime FAUCET key (the owner decision for devnet);
 * - config: keeper = a runtime keeper key, window 1, 60 s staleness, fee 0;
 * - xAAPL and xTSLA registered with their real Pyth feed ids (the two feeds with recorded real
 *   devnet prices, tests/fixtures/pyth-devnet-price-updates.json);
 * - a test Wormhole guardian set + receiver config, and a fake Hermes signing fresh updates of
 *   the RECORDED prices with that guardian, so the keeper posts fully verified prices.
 * Prints `READY <state.json>` and runs until SIGTERM. Never touches devnet or mainnet.
 */
import fs from "node:fs";
import path from "node:path";
import {
  address,
  generateKeyPairSigner,
  lamports,
  type KeyPairSigner,
} from "@solana/kit";
import * as v1 from "@aroma/guard";
import { XSTOCKS_PYTH_FEEDS } from "@aroma/guard/pyth";
import { parseArgs } from "./lib/args";
import { DEVNET_ASSETS, feedBytes, TEST_USD } from "./lib/assets";
import { e2eConfig } from "./lib/e2e-support";
import { pinnedSo, startValidator } from "./lib/e2e-validator";
import { CONTRACTS_ROOT, newExportableKeypair } from "./lib/keys";
import {
  createTestGuardian,
  localPythAccounts,
  startFakeHermes,
} from "./lib/pyth-local";
import {
  ataIx,
  createClassicMintIxs,
  createMockStockIxs,
  SCALED_MINT_SPACE,
} from "./lib/tokens";

const args = parseArgs(process.argv.slice(2), {
  values: ["--work", "--port", "--hermes-port"],
});
const WORK = path.resolve(
  args.values.get("--work") ?? path.join(CONTRACTS_ROOT, "../../.e2e-invest"),
);
const PORT = Number(args.values.get("--port") ?? 18_999);
const HERMES_PORT = Number(args.values.get("--hermes-port") ?? 4_020);
const SO = path.join(CONTRACTS_ROOT, "target/build/devnet-mock/aroma_guard.so");
const log = (...parts: unknown[]) => console.error("[invest-chain]", ...parts);

/** Recorded real devnet prices (feed id from the PriceUpdateV2 bytes, price, conf, expo). */
function recordedPrices() {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(
        CONTRACTS_ROOT,
        "tests/fixtures/pyth-devnet-price-updates.json",
      ),
      "utf8",
    ),
  ) as { priceUpdates: { symbol: string; dataBase64: string }[] };
  return fixture.priceUpdates.map((p) => {
    const b = Buffer.from(p.dataBase64, "base64");
    const o = 8 + 32 + 1;
    const feedId = `0x${b.subarray(o, o + 32).toString("hex")}`;
    const expected = XSTOCKS_PYTH_FEEDS[p.symbol]?.equityReferenceFeedId;
    if (feedId !== expected)
      throw new Error(`recorded ${p.symbol} feed ${feedId} is not ${expected}`);
    return {
      symbol: p.symbol,
      feedId,
      price: b.readBigInt64LE(o + 32),
      conf: b.readBigUInt64LE(o + 40),
      expo: b.readInt32LE(o + 48),
    };
  });
}

async function exportable(): Promise<{
  signer: KeyPairSigner;
  secret: number[];
}> {
  return newExportableKeypair();
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK, "accounts"), { recursive: true, mode: 0o700 });
  const [deployer, keeper, faucet, treasury, wallet, walletB] = [
    await exportable(),
    await exportable(),
    await exportable(),
    await exportable(),
    await exportable(),
    await exportable(),
  ];
  const guardian = createTestGuardian();
  const now = Math.floor(Date.now() / 1000);
  const source = {
    chain: 26,
    emitter: address("6R92oFT6UiP2xWZBjTbwAkHzFCLy5BhWnNh6m83ndhZR"),
  };
  const accountArgs: string[] = [];
  for (const account of await localPythAccounts({
    guardians: [guardian],
    guardianSetIndex: 0,
    source,
    governance: deployer.signer.address,
    creationTime: now - 60,
  })) {
    const file = path.join(WORK, "accounts", `${account.address}.json`);
    fs.writeFileSync(file, account.json);
    accountArgs.push("--account", account.address, file);
  }
  accountArgs.push(
    "--bpf-program",
    "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ",
    pinnedSo("wormhole"),
    "--upgradeable-program",
    v1.V1_PROGRAM_ID,
    SO,
    deployer.signer.address,
  );
  const { child, c } = await startValidator(WORK, PORT, accountArgs);
  const shutdown = () => {
    child.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  const genesis = await c.rpc.getGenesisHash().send();
  for (const who of [deployer, keeper, faucet])
    await c.rpc
      .requestAirdrop(who.signer.address, lamports(20_000_000_000n))
      .send();
  await new Promise((r) => setTimeout(r, 2_000));

  const usd = await generateKeyPairSigner();
  const rent82 = await c.rpc.getMinimumBalanceForRentExemption(82n).send();
  await c.send(
    deployer.signer,
    createClassicMintIxs(
      deployer.signer,
      usd,
      TEST_USD.decimals,
      faucet.signer.address,
      rent82,
    ),
  );
  const config = {
    ...e2eConfig({
      admin: deployer.signer.address,
      keeper: keeper.signer.address,
      usd: usd.address,
      treasury: treasury.signer.address,
    }),
    maxOracleStalenessS: 60,
  };
  await c.send(deployer.signer, [
    await v1.buildInitializeConfigInstruction({
      authority: deployer.signer,
      params: config,
    }),
  ]);
  const rentScaled = await c.rpc
    .getMinimumBalanceForRentExemption(BigInt(SCALED_MINT_SPACE))
    .send();
  const prices = recordedPrices();
  const stocks: { symbol: string; mint: string; feedId: string }[] = [];
  for (const p of prices) {
    const mint = await generateKeyPairSigner();
    const authority = await v1.findMockMintAuthorityPda(mint.address);
    // The live ScaledUiAmount multiplier (lib/assets.ts); TSLA pays no dividend (exactly 1).
    const multiplier =
      DEVNET_ASSETS.find((a) => a.underlying === p.symbol)?.multiplier ?? 1;
    await c.send(
      deployer.signer,
      createMockStockIxs(
        deployer.signer,
        mint,
        8,
        authority,
        multiplier,
        rentScaled,
      ),
    );
    await c.send(deployer.signer, [
      await v1.buildRegisterAssetInstruction({
        admin: deployer.signer,
        mint: mint.address,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        pythFeedId: feedBytes(p.feedId.slice(2)),
      }),
    ]);
    stocks.push({ symbol: p.symbol, mint: mint.address, feedId: p.feedId });
  }
  await c.send(deployer.signer, [
    ataIx(
      deployer.signer,
      treasury.signer.address,
      usd.address,
      v1.TOKEN_PROGRAM_ID,
    ),
  ]);
  const hermes = await startFakeHermes({
    port: HERMES_PORT,
    guardians: [guardian],
    guardianSetIndex: 0,
    source,
    prices: new Map(
      prices.map((p) => [
        p.feedId,
        { price: p.price, conf: p.conf, expo: p.expo },
      ]),
    ),
  });
  const state = {
    rpcUrl: `http://127.0.0.1:${PORT}`,
    genesis,
    programId: v1.V1_PROGRAM_ID,
    testUsd: usd.address,
    stocks,
    hermesUrl: hermes.url,
    keeper: { address: keeper.signer.address, secret: keeper.secret },
    faucet: { address: faucet.signer.address, secret: faucet.secret },
    wallet: { address: wallet.signer.address, secret: wallet.secret },
    walletB: { address: walletB.signer.address, secret: walletB.secret },
    treasury: treasury.signer.address,
    recordedPrices: prices.map((p) => ({
      ...p,
      price: p.price.toString(),
      conf: p.conf.toString(),
    })),
  };
  const file = path.join(WORK, "state.json");
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  log(
    "validator",
    state.rpcUrl,
    "genesis",
    genesis,
    "| program",
    v1.V1_PROGRAM_ID,
    "| tUSD",
    usd.address,
    "| stocks",
    stocks.map((s) => s.symbol).join(","),
  );
  console.log(`READY ${file}`);
  await new Promise(() => {});
}

main().catch((error: Error) => {
  console.error("[invest-chain] FAILED", error.message);
  process.exit(1);
});
