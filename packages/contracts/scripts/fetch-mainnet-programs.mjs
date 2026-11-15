#!/usr/bin/env node
// Read-only: downloads the mainnet program binaries pinned in tests/fixtures/mainnet-programs.json
// (Jupiter, Whirlpool, Token, Token-2022) and mainnet's Subscriptions binary (runtime-programs.json
// `mainnetSha256`, M8 decision 2) into target/test-programs, verifying every SHA-256. Refuses any
// RPC whose genesis is not mainnet's. Never sends a transaction, never loads a wallet.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAddressDecoder } from "@solana/kit";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const mainnet = read("tests/fixtures/mainnet-programs.json");
const runtime = read("tests/fixtures/runtime-programs.json");
const DIR =
  process.env.OVELO_V1_PROGRAM_DIR || path.join(root, "target/test-programs");
const RPC =
  process.env.OVELO_V1_MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(`Mainnet read failed: ${method}`);
  return body.result;
}

async function fetchBinary(programId, sha256, file) {
  const program = (
    await rpc("getAccountInfo", [programId, { encoding: "base64" }])
  ).value;
  if (!program?.executable || program.owner !== LOADER)
    throw new Error(`Not an upgradeable program: ${programId}`);
  const programData = getAddressDecoder().decode(
    Buffer.from(program.data[0], "base64").subarray(4, 36),
  );
  const data = Buffer.from(
    (await rpc("getAccountInfo", [programData, { encoding: "base64" }])).value
      .data[0],
    "base64",
  );
  const binary = data.subarray(45);
  const sha = crypto.createHash("sha256").update(binary).digest("hex");
  if (sha !== sha256)
    throw new Error(
      `Mainnet ${programId} changed (sha256 ${sha}). Re-record (fixtures:jupiter), review, re-pin.`,
    );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, binary);
  console.log(`Verified ${programId}: ${sha}`);
}

async function main() {
  if ((await rpc("getGenesisHash")) !== mainnet.genesisHash)
    throw new Error("Mainnet fixtures are fetched from Solana mainnet only.");
  for (const [id, pin] of Object.entries(mainnet.programs))
    await fetchBinary(id, pin.sha256, path.join(DIR, "mainnet", `${id}.so`));
  const subs = runtime.programs.subscriptions;
  await fetchBinary(
    subs.programId,
    subs.mainnetSha256,
    path.join(DIR, "subscriptions-mainnet.so"),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
