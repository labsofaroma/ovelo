#!/usr/bin/env node
// Keeps the Rust program, the committed IDL and the generated client in sync (AGENTS.md rule 6).
//   (no flag)          copy the built IDL to apps/web and regenerate the client
//   --check            fail if the built IDL or the generated client differ from what is committed
//   --check-generated  fail if the generated client differs from a fresh render of the committed
//                      IDL (no build needed; run by `pnpm test`)
// Never loads a wallet and never deploys.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderClient, diffDirs } from './codama.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const v1 = path.resolve(root, '../../apps/web/lib/sdk/guard/v1');
export const COMMITTED_IDL = path.join(v1, 'idl', 'aroma_guard.json');
export const GENERATED = path.join(v1, 'generated');
const BUILT_IDL = path.join(root, 'target/build/mainnet/aroma_guard.json');
const BUILT_IDL_DEVNET = path.join(root, 'target/build/devnet-mock/aroma_guard.json');

const canonical = (json) => JSON.stringify(json, null, 2) + '\n';

export async function generatedDrift(idlPath = COMMITTED_IDL, generatedDir = GENERATED) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-drift-'));
  try {
    await renderClient(JSON.parse(fs.readFileSync(idlPath, 'utf8')), tmp);
    return diffDirs(tmp, generatedDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function builtIdl() {
  for (const file of [BUILT_IDL, BUILT_IDL_DEVNET]) {
    if (!fs.existsSync(file)) throw new Error(`Missing ${path.relative(root, file)}. Run \`pnpm --filter @aroma/contracts build\` first.`);
  }
  const mainnet = fs.readFileSync(BUILT_IDL, 'utf8');
  if (mainnet !== fs.readFileSync(BUILT_IDL_DEVNET, 'utf8')) throw new Error('The mainnet and devnet-mock builds have different IDLs.');
  return canonical(JSON.parse(mainnet));
}

async function main() {
  const mode = process.argv[2] ?? '';
  if (mode === '--check-generated') {
    const drift = await generatedDrift();
    if (drift.length) throw new Error(`Generated client drifted from the IDL: ${drift.join(', ')}`);
    console.log('Generated client matches the committed IDL.');
    return;
  }
  const idl = builtIdl();
  if (mode === '--check') {
    if (!fs.existsSync(COMMITTED_IDL) || fs.readFileSync(COMMITTED_IDL, 'utf8') !== idl)
      throw new Error('Committed IDL differs from the Rust program. Run `pnpm --filter @aroma/contracts idl:sync`.');
    const drift = await generatedDrift();
    if (drift.length) throw new Error(`Generated client drifted from the IDL: ${drift.join(', ')}`);
    console.log('IDL and generated client match the Rust program.');
    return;
  }
  fs.mkdirSync(path.dirname(COMMITTED_IDL), { recursive: true });
  fs.writeFileSync(COMMITTED_IDL, idl);
  await renderClient(JSON.parse(idl), GENERATED);
  console.log('Updated the v1 IDL and generated client from the Rust program.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
