#!/usr/bin/env vite-node
/**
 * Devnet only (refuses any other genesis). Run by the owner after init-devnet:
 *   pnpm --filter @aroma/contracts devnet:register [--rpc URL] [--deployer PATH] [--symbols AAPL,MSFT] [--list] [--dry-run]
 * For each devnet asset (lib/assets.ts): creates its Token-2022 mock mint with ScaledUiAmount and
 * mint authority = the asset's ["mock_mint", mint] PDA (no freeze authority), then register_asset
 * with the REAL Pyth feed id of the underlying equity. Idempotent and resumable (.devnet/state.json).
 */
import type { Address } from "@solana/kit";
import * as v1 from "../../../apps/web/lib/sdk/guard/v1";
import { DEFAULT_DEPLOYER, DEFAULT_DEVNET_RPC, parseArgs } from "./lib/args";
import { feedBytes, selectAssets } from "./lib/assets";
import { assertDevnet } from "./lib/cluster";
import { loadState, rpcDeps } from "./lib/devnet-state";
import { readKeypair } from "./lib/keys";
import { ensureMint } from "./lib/provision";
import { connect } from "./lib/send";
import { createMockStockIxs, SCALED_MINT_SPACE } from "./lib/tokens";

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    flags: ["--list", "--dry-run"],
    values: ["--rpc", "--deployer", "--symbols"],
  });
  const assets = selectAssets(args.values.get("--symbols"));
  if (args.flags.has("--list")) {
    console.log(JSON.stringify(assets, null, 2));
    return;
  }
  const c = connect(args.values.get("--rpc") ?? DEFAULT_DEVNET_RPC);
  await assertDevnet(c.rpc);
  const state = loadState();
  if (!state.testUsd)
    throw new Error(
      "Run init-devnet first (it creates the test USD and the config).",
    );
  const admin = await readKeypair(
    args.values.get("--deployer") ?? DEFAULT_DEPLOYER,
  );
  const deps = rpcDeps(c);
  const rent = await c.rpc
    .getMinimumBalanceForRentExemption(BigInt(SCALED_MINT_SPACE))
    .send();
  const results = [];
  for (const asset of assets) {
    if (args.flags.has("--dry-run")) {
      results.push({
        symbol: asset.symbol,
        mint: state.assets[asset.symbol]?.mint ?? "(to be created)",
        feedId: asset.feedId,
      });
      continue;
    }
    const record = await ensureMint(
      deps,
      state,
      (r) =>
        (state.assets[asset.symbol] = { ...state.assets[asset.symbol], ...r }),
      state.assets[asset.symbol],
      {
        label: asset.symbol,
        tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
        decimals: asset.decimals,
        mintAuthority: (mint: Address) => v1.findMockMintAuthorityPda(mint),
        scaled: true,
      },
      admin,
      async (mint) =>
        createMockStockIxs(
          admin,
          mint,
          asset.decimals,
          await v1.findMockMintAuthorityPda(mint.address),
          asset.multiplier,
          rent,
        ),
    );
    const assetPda = await v1.findAssetPda(record.mint);
    const existing = await deps.readAccount(assetPda);
    let signature = "already registered";
    if (existing) {
      const a = v1.decodeAssetAccount(existing.data);
      if (
        a.mint !== record.mint ||
        Buffer.from(a.pythFeedId).toString("hex") !== asset.feedId
      )
        throw new Error(
          `${asset.symbol}: the registered asset differs from the expected mint or feed.`,
        );
    } else {
      signature = await c.send(admin, [
        await v1.buildRegisterAssetInstruction({
          admin,
          mint: record.mint,
          tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
          pythFeedId: feedBytes(asset.feedId),
        }),
      ]);
    }
    state.assets[asset.symbol] = { ...record, registered: true };
    await deps.save(state);
    results.push({
      symbol: asset.symbol,
      mint: record.mint,
      asset: assetPda,
      feedId: asset.feedId,
      multiplier: asset.multiplier,
      signature,
    });
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
