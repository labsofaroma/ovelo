#!/usr/bin/env node
// Read-only: downloads the pinned upstream program binaries from devnet for LiteSVM and the
// local validator, and verifies each SHA-256. Never sends a transaction, never loads a wallet.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getAddressDecoder } from "@solana/kit";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/runtime-programs.json"),
    "utf8",
  ),
);
export const PROGRAM_DIR =
  process.env.AROMA_V1_PROGRAM_DIR || path.join(root, "target/test-programs");
const endpoint =
  process.env.AROMA_V1_FIXTURE_RPC || "https://api.devnet.solana.com";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

async function rpc(method, params = []) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(`Devnet read failed: ${method}`);
  return body.result;
}

export function verifiedBinary(name) {
  const file = path.join(PROGRAM_DIR, `${name}.so`);
  const bytes = fs.readFileSync(file);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== manifest.programs[name].sha256)
    throw new Error(`${name}.so does not match its pinned SHA-256.`);
  return bytes;
}

async function main() {
  if ((await rpc("getGenesisHash")) !== manifest.genesisHash)
    throw new Error("Fixtures are fetched from Solana devnet only.");
  fs.mkdirSync(PROGRAM_DIR, { recursive: true });
  for (const [name, pin] of Object.entries(manifest.programs)) {
    const program = (
      await rpc("getAccountInfo", [pin.programId, { encoding: "base64" }])
    ).value;
    if (!program?.executable || program.owner !== LOADER)
      throw new Error(`Not an upgradeable program: ${name}`);
    const programData = getAddressDecoder().decode(
      Buffer.from(program.data[0], "base64").subarray(4, 36),
    );
    if (programData !== pin.programData)
      throw new Error(`ProgramData address changed: ${name}`);
    const data = Buffer.from(
      (await rpc("getAccountInfo", [programData, { encoding: "base64" }])).value
        .data[0],
      "base64",
    );
    if (data.readUInt32LE(0) !== 3)
      throw new Error(`Invalid ProgramData: ${name}`);
    const binary = data.subarray(45);
    const sha = crypto.createHash("sha256").update(binary).digest("hex");
    if (sha !== pin.sha256)
      throw new Error(
        `Upstream ${name} changed (sha256 ${sha}). Review the new binary, then re-pin.`,
      );
    fs.writeFileSync(path.join(PROGRAM_DIR, `${name}.so`), binary);
    console.log(`Verified ${name}: ${sha}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
