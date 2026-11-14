#!/usr/bin/env vite-node
/**
 * Devnet only (refuses any other genesis). Run by the owner after deploy-devnet.sh:
 *   pnpm --filter @aroma/contracts devnet:init [--rpc URL] [--deployer PATH] [--dry-run]
 * 1. Creates the test USD (classic SPL, 6 dp) if it does not exist. Its mint authority is the
 *    devnet-only FAUCET key (.keys/devnet-faucet.json, created here when missing; M7 decision),
 *    never the deployer: the faucet key becomes a server secret, the deployer never does.
 * 2. initialize_config, signed by the deployer (= upgrade authority), with the M6 decisions:
 *    keeper = the devnet-only keeper (.keys/devnet-keeper.json), fee 0, catch-up window 1,
 *    test USD as the only funding mint, treasury = the deployer.
 * Idempotent: an existing config is compared with the expected values and never overwritten.
 */
import fs from "node:fs";
import path from "node:path";
import { address, type Address } from "@solana/kit";
import * as v1 from "@aroma/guard";
import { DEFAULT_DEPLOYER, DEFAULT_DEVNET_RPC, parseArgs } from "./lib/args";
import { assertDevnet } from "./lib/cluster";
import { devnetConfig } from "./lib/devnet-config";
import { loadState, rpcDeps } from "./lib/devnet-state";
import { CONTRACTS_ROOT, ensureKeypair, readKeypair } from "./lib/keys";
import { ensureMint, parseMintFacts } from "./lib/provision";
import { connect } from "./lib/send";
import { TEST_USD } from "./lib/assets";
import { createClassicMintIxs } from "./lib/tokens";

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    flags: ["--dry-run"],
    values: ["--rpc", "--deployer", "--faucet"],
  });
  const c = connect(args.values.get("--rpc") ?? DEFAULT_DEVNET_RPC);
  await assertDevnet(c.rpc);
  const deployer = await readKeypair(
    args.values.get("--deployer") ?? DEFAULT_DEPLOYER,
  );
  const keeper = (
    await readKeypair(path.join(CONTRACTS_ROOT, ".keys/devnet-keeper.json"))
  ).address;
  const faucet = await faucetAuthority(args.values.get("--faucet"));
  if (faucet === deployer.address)
    throw new Error(
      "The faucet key must not be the deployer: the deployer is never a server secret.",
    );
  const state = loadState();
  const deps = rpcDeps(c);
  if (args.flags.has("--dry-run")) {
    console.log(
      JSON.stringify(
        {
          deployer: deployer.address,
          keeper,
          faucet,
          testUsd: state.testUsd?.mint ?? "(to be created)",
          config: await v1.findConfigPda(),
        },
        null,
        2,
      ),
    );
    return;
  }
  await refuseDeployerMintAuthority(deps, state, deployer.address, faucet);
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
      mintAuthority: faucet,
      scaled: false,
    },
    deployer,
    async (mint) =>
      createClassicMintIxs(deployer, mint, TEST_USD.decimals, faucet, rent),
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
        testUsdMintAuthority: faucet,
        treasury: deployer.address,
      },
      null,
      2,
    ),
  );
}

/** `--faucet <pubkey>` reuses an existing faucet key; otherwise `.keys/devnet-faucet.json`. */
async function faucetAuthority(given: string | undefined): Promise<Address> {
  if (given) return address(given);
  const file = path.join(CONTRACTS_ROOT, ".keys/devnet-faucet.json");
  const created = !fs.existsSync(file);
  const signer = await ensureKeypair(file);
  if (created)
    console.error(
      `Created the devnet-only faucet key ${signer.address} in .keys/devnet-faucet.json (git-ignored). Back it up; it becomes AROMA_V1_FAUCET_KEYPAIR.`,
    );
  return signer.address;
}

/**
 * A test USD created before M7 has the deployer as mint authority. Never continue with it:
 * print the one command the owner runs to hand the authority to the faucet key.
 */
async function refuseDeployerMintAuthority(
  deps: ReturnType<typeof rpcDeps>,
  state: ReturnType<typeof loadState>,
  deployer: Address,
  faucet: Address,
): Promise<void> {
  if (state.testUsd?.status !== "created") return;
  const account = await deps.readAccount(state.testUsd.mint);
  if (!account) return;
  const facts = parseMintFacts(account.owner, account.data);
  if (facts.mintAuthority === deployer)
    throw new Error(
      `The test USD ${state.testUsd.mint} still has the deployer as mint authority. Hand it to the faucet key, then rerun:\n` +
        `  spl-token authorize ${state.testUsd.mint} mint ${faucet} --url devnet --owner <deployer keypair>`,
    );
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
