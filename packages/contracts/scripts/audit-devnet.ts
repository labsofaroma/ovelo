#!/usr/bin/env vite-node
/**
 * READ-ONLY audit of the Ovelo Guard v1 devnet deployment (refuses any other genesis; never
 * signs, never sends): upgrade authority = the owner's deployer, config admin and keeper, the
 * M6 decisions, no foreign funding mint, test USD and every asset's mint authority.
 *   pnpm --filter @ovelo/contracts devnet:audit --deployer <DEPLOYER_PUBKEY> [--keeper PUBKEY] [--faucet PUBKEY] [--rpc URL]
 */
import fs from "node:fs";
import path from "node:path";
import { address } from "@solana/kit";
import * as v1 from "@ovelo/guard";
import { DEFAULT_DEVNET_RPC, parseArgs } from "./lib/args";
import { auditDevnet } from "./lib/audit";
import { STATE_FILE } from "./lib/devnet-state";
import { httpRpc } from "./lib/jsonrpc";
import { CONTRACTS_ROOT } from "./lib/keys";
import type { ProvisionState } from "./lib/provision";
import { execFileSync } from "node:child_process";

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    values: ["--rpc", "--deployer", "--keeper", "--faucet"],
  });
  const deployer = args.values.get("--deployer");
  if (!deployer)
    throw new Error(
      "--deployer <pubkey> is required (solana-keygen pubkey ~/.config/solana/ovelo-deployer.json).",
    );
  const keeperFile = path.join(CONTRACTS_ROOT, ".keys/devnet-keeper.json");
  const keeper =
    args.values.get("--keeper") ??
    execFileSync("solana-keygen", ["pubkey", keeperFile], {
      encoding: "utf8",
    }).trim();
  const faucetFile = path.join(CONTRACTS_ROOT, ".keys/devnet-faucet.json");
  const faucet =
    args.values.get("--faucet") ??
    execFileSync("solana-keygen", ["pubkey", faucetFile], {
      encoding: "utf8",
    }).trim();
  const state = fs.existsSync(STATE_FILE)
    ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as ProvisionState)
    : null;
  const report = await auditDevnet(
    httpRpc(args.values.get("--rpc") ?? DEFAULT_DEVNET_RPC),
    {
      programId: v1.OVELO_GUARD_V1_PROGRAM_ID,
      deployer: address(deployer),
      keeper: address(keeper),
      faucet: address(faucet),
      testUsd: state?.testUsd?.mint ?? null,
    },
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
