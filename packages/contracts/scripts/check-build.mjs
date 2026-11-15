#!/usr/bin/env node
// Proves which build contains minting code, from the compiled binaries (M6 exit criterion).
// The devnet-mock handler logs a unique marker and is the only code that uses the
// `mock_mint` seed; neither may appear in the default (mainnet) binary.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const MARKER = "ovelo-guard: devnet-mock mint at oracle price";
const SEED = "mock_mint";
// M8: the Jupiter route_v2 CPI path exists only in the default build (integrations/jupiter.rs).
const JUPITER_MARKER = "ovelo-guard: jupiter route_v2 cpi";
const read = (variant) =>
  fs.readFileSync(path.join(root, "target/build", variant, "ovelo_guard.so"));
const has = (bytes, text) => bytes.includes(Buffer.from(text));
// ELF e_flags (offset 48) is the SBPF version; devnet and mainnet only deploy v0 today.
const sbpfVersion = (bytes) => bytes.readUInt32LE(48);
const mainnet = read("mainnet");
const devnet = read("devnet-mock");
const report = {
  mainnet: {
    sbpf: sbpfVersion(mainnet),
    bytes: mainnet.length,
    sha256: crypto.createHash("sha256").update(mainnet).digest("hex"),
    marker: has(mainnet, MARKER),
    mockMintSeed: has(mainnet, SEED),
    jupiterCpi: has(mainnet, JUPITER_MARKER),
  },
  "devnet-mock": {
    sbpf: sbpfVersion(devnet),
    bytes: devnet.length,
    sha256: crypto.createHash("sha256").update(devnet).digest("hex"),
    marker: has(devnet, MARKER),
    mockMintSeed: has(devnet, SEED),
    jupiterCpi: has(devnet, JUPITER_MARKER),
  },
};
console.log(JSON.stringify(report, null, 2));
if (report.mainnet.sbpf !== 0 || report["devnet-mock"].sbpf !== 0) {
  console.error(
    "Both builds must be SBPF v0 (deployable on devnet and mainnet).",
  );
  process.exit(1);
}
if (report.mainnet.marker || report.mainnet.mockMintSeed) {
  console.error("The default (mainnet) build contains devnet minting code.");
  process.exit(1);
}
if (!report["devnet-mock"].marker || !report["devnet-mock"].mockMintSeed) {
  console.error("The devnet-mock build is missing its minting path.");
  process.exit(1);
}
if (!report.mainnet.jupiterCpi) {
  console.error("The default (mainnet) build is missing the Jupiter CPI path.");
  process.exit(1);
}
if (report["devnet-mock"].jupiterCpi) {
  console.error("The devnet-mock build contains the Jupiter CPI path.");
  process.exit(1);
}
console.log("OK: minting code exists only in the devnet-mock build.");
console.log(
  "OK: the Jupiter CPI path exists only in the default (mainnet) build.",
);
