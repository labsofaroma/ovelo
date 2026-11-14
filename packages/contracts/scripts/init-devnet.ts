#!/usr/bin/env vite-node
/**
 * Devnet only (refuses any other genesis). Run by the owner after deploy-devnet.sh:
 *   pnpm --filter @aroma/contracts devnet:init [--rpc URL] [--deployer PATH] [--dry-run]
 * 1. Creates the test USD (classic SPL, 6 dp, mint authority = deployer) if it does not exist.
 * 2. initialize_config, signed by the deployer (= upgrade authority), with the M6 decisions:
 *    keeper = the devnet-only keeper (.keys/devnet-keeper.json), fee 0, catch-up window 1,
 *    test USD as the only funding mint, treasury = the deployer.
 * Idempotent: an existing config is compared with the expected values and never overwritten.
 */
import path from "node:path";
import * as v1 from "../../../apps/web/lib/sdk/guard/v1";
import { DEFAULT_DEPLOYER, DEFAULT_DEVNET_RPC, parseArgs } from "./lib/args";
import { assertDevnet } from "./lib/cluster";
import { devnetConfig } from "./lib/devnet-config";
import { loadState, rpcDeps } from "./lib/devnet-state";
import { CONTRACTS_ROOT, readKeypair } from "./lib/keys";
import { ensureMint } from "./lib/provision";
import { connect } from "./lib/send";
import { TEST_USD } from "./lib/assets";
import { createClassicMintIxs } from "./lib/tokens";

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    flags: ["--dry-run"],
    values: ["--rpc", "--deployer"],
  });
  const c = connect(args.values.get("--rpc") ?? DEFAULT_DEVNET_RPC);
  await assertDevnet(c.rpc);
  const deployer = await readKeypair(
    args.values.get("--deployer") ?? DEFAULT_DEPLOYER,
  );
  const keeper = (
    await readKeypair(path.join(CONTRACTS_ROOT, ".keys/devnet-keeper.json"))
  ).address;
  const state = loadState();
  const deps = rpcDeps(c);
  if (args.flags.has("--dry-run")) {
    console.log(
      JSON.stringify(
        {
          deployer: deployer.address,
          keeper,
          testUsd: state.testUsd?.mint ?? "(to be created)",
          config: await v1.findConfigPda(),
        },
        null,
        2,
      ),
    );
    return;
  }
  const rent = await c.rpc.getMinimumBalanceForRentExemption(82n).send();
  const usd = await ensureMint(
    deps,
    state,
    (r) => (state.testUsd = r),
    state.testUsd,
    {
      label: "test USD",
      tokenProgram: v1.TOKEN_PROGRAM_ID,
      decimals: TEST_USD.decimals,
      mintAuthority: deployer.address,
      scaled: false,
    },
    deployer,
    async (mint) =>
      createClassicMintIxs(
        deployer,
        mint,
        TEST_USD.decimals,
        deployer.address,
        rent,
      ),
  );
  const params = devnetConfig({
    admin: deployer.address,
    keeper,
    testUsd: usd.mint,
    treasury: deployer.address,
  });
  const configAddress = await v1.findConfigPda();
  const existing = await deps.readAccount(configAddress);
  if (existing) {
    const config = v1.decodeConfigAccount(existing.data);
    const same =
      config.admin === params.admin &&
      config.allowedFundingMints[0] === usd.mint &&
      config.catchUpWindowPeriods === params.catchUpWindowPeriods &&
      config.protocolFeeBps === params.protocolFeeBps;
    console.log(
      same
        ? `Config already initialized at ${configAddress} with the expected values.`
        : `Config at ${configAddress} differs from the expected values; not changed. Run audit-devnet for details.`,
    );
    if (!same) process.exitCode = 1;
    return;
  }
  const signature = await c.send(deployer, [
    await v1.buildInitializeConfigInstruction({ authority: deployer, params }),
  ]);
  console.log(
    JSON.stringify(
      {
        initialized: configAddress,
        signature,
        admin: deployer.address,
        keeper,
        testUsd: usd.mint,
        treasury: deployer.address,
      },
      null,
      2,
    ),
  );
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
