#!/usr/bin/env node
// Refuses to build or deploy unless one program ID is used everywhere:
//   the program keypair (target/deploy/aroma_guard-keypair.json), `declare_id!`,
//   every `aroma_guard = "…"` in Anchor.toml, the built IDLs, and `--expect` if given.
// A missing keypair is an error: `anchor build` would silently create a NEW one (new program ID).
// Only the public key is derived and printed; the secret bytes never leave this process.
//   node scripts/check-program-id.mjs [--root DIR] [--require-idl] [--expect PUBKEY]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = path.resolve(
  valueOf("--root") ??
    path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
);
const requireIdl = argv.includes("--require-idl");
const expect = valueOf("--expect");

const KEYPAIR = "target/deploy/aroma_guard-keypair.json";
const LIB = "programs/aroma_guard/src/lib.rs";
const IDLS = [
  "target/idl/aroma_guard.json",
  "target/build/mainnet/aroma_guard.json",
  "target/build/devnet-mock/aroma_guard.json",
];

function fail(message) {
  console.error(`check-program-id: ${message}`);
  process.exit(1);
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** The public key of a Solana keypair file, checked against its seed. */
function keypairPubkey(file) {
  let bytes;
  try {
    bytes = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail(`${KEYPAIR} is not a readable keypair file.`);
  }
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  )
    fail(`${KEYPAIR} is not a 64-byte keypair file.`);
  const seed = Buffer.from(bytes.slice(0, 32));
  const stored = Buffer.from(bytes.slice(32));
  // PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410).
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const derived = crypto
    .createPublicKey(
      crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }),
    )
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  if (!derived.equals(stored))
    fail(`${KEYPAIR} is corrupt: its public half does not match its seed.`);
  return base58(derived);
}

const keypairFile = path.join(root, KEYPAIR);
if (!fs.existsSync(keypairFile))
  fail(
    `${KEYPAIR} is missing. Refusing to continue: \`anchor build\` would generate a NEW program keypair ` +
      `(a different program ID). Restore the real one from your backup (docs/M6-DEVNET-DEPLOY.md §1) and retry.`,
  );

const sources = [["program keypair", keypairPubkey(keypairFile)]];

const lib = fs.readFileSync(path.join(root, LIB), "utf8");
const declared = [
  ...lib.matchAll(/declare_id!\(\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*\)/g),
];
if (declared.length !== 1) fail(`expected one declare_id! in ${LIB}.`);
sources.push(["declare_id!", declared[0][1]]);

const toml = fs.readFileSync(path.join(root, "Anchor.toml"), "utf8");
let section = "";
let tomlEntries = 0;
for (const line of toml.split("\n")) {
  const header = line.match(/^\s*\[([^\]]+)\]/);
  if (header) section = header[1].trim();
  const entry = line.match(/^\s*aroma_guard\s*=\s*"([^"]+)"/);
  if (entry && section.startsWith("programs.")) {
    sources.push([`Anchor.toml [${section}]`, entry[1]]);
    tomlEntries += 1;
  }
}
if (tomlEntries === 0)
  fail("Anchor.toml has no [programs.*] aroma_guard entry.");

for (const idl of IDLS) {
  const file = path.join(root, idl);
  if (!fs.existsSync(file)) {
    if (requireIdl) fail(`${idl} is missing after the build.`);
    continue;
  }
  sources.push([idl, JSON.parse(fs.readFileSync(file, "utf8")).address]);
}
if (expect) sources.push(["expected (--expect)", expect]);

const ids = new Set(sources.map(([, id]) => id));
if (ids.size !== 1)
  fail(
    `program IDs disagree. Refusing to build or deploy.\n` +
      sources.map(([where, id]) => `  ${id}  ${where}`).join("\n") +
      `\nThe program keypair defines the deployed address; restore the right one (docs/M6-DEVNET-DEPLOY.md §1).`,
  );
console.log(
  `OK: program ID ${sources[0][1]} matches ${sources.map(([where]) => where).join(", ")}.`,
);
