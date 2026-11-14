/** Keypair files for localnet and devnet-only keys. Never used with mainnet. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

export const CONTRACTS_ROOT = path.resolve(import.meta.dirname, "../..");

export async function readKeypair(file: string): Promise<KeyPairSigner> {
  const resolved = file.replace(/^~(?=\/)/, process.env.HOME ?? "~");
  const bytes = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  if (!Array.isArray(bytes) || bytes.length !== 64)
    throw new Error(`${file} is not a keypair file.`);
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes));
}

/** Refuses to write a key anywhere git would track it. */
export function assertIgnored(file: string): void {
  try {
    execFileSync("git", ["check-ignore", "-q", file], { cwd: CONTRACTS_ROOT });
  } catch {
    throw new Error(
      `Refusing to write a keypair to ${file}: the path is not git-ignored.`,
    );
  }
}

/** Reads `file`, or creates it (mode 600) with `solana-keygen` when missing. */
export async function ensureKeypair(file: string): Promise<KeyPairSigner> {
  if (!fs.existsSync(file)) {
    assertIgnored(file);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    execFileSync(
      "solana-keygen",
      ["new", "--no-bip39-passphrase", "--silent", "-o", file],
      { stdio: "ignore" },
    );
    fs.chmodSync(file, 0o600);
  }
  return readKeypair(file);
}
