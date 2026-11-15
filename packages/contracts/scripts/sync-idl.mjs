#!/usr/bin/env node
// Keeps the Rust program, the committed IDL and the generated client in sync (AGENTS.md rule 6).
//   (no flag)          copy the built IDL to packages/guard and regenerate the client
//   --check            fail if the built IDL or the generated client differ from what is committed
//   --check-generated  fail if the generated client differs from a fresh render of the committed
//                      IDL (no build needed; run by `pnpm test`)
// Never loads a wallet and never deploys.
import fs from "node:fs";
import path from "node:path";
import {
  COMMITTED_IDL,
  GENERATED,
  generatedDrift,
  renderClient,
} from "../../guard/scripts/codama.mjs";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const BUILT_IDL = path.join(root, "target/build/mainnet/ovelo_guard.json");
const BUILT_IDL_DEVNET = path.join(
  root,
  "target/build/devnet-mock/ovelo_guard.json",
);

const canonical = (json) => JSON.stringify(json, null, 2) + "\n";

function builtIdl() {
  for (const file of [BUILT_IDL, BUILT_IDL_DEVNET]) {
    if (!fs.existsSync(file))
      throw new Error(
        `Missing ${path.relative(root, file)}. Run \`pnpm --filter @ovelo/contracts build\` first.`,
      );
  }
  const mainnet = fs.readFileSync(BUILT_IDL, "utf8");
  if (mainnet !== fs.readFileSync(BUILT_IDL_DEVNET, "utf8"))
    throw new Error("The mainnet and devnet-mock builds have different IDLs.");
  return canonical(JSON.parse(mainnet));
}

async function main() {
  const mode = process.argv[2] ?? "";
  if (mode === "--check-generated") {
    const drift = await generatedDrift();
    if (drift.length)
      throw new Error(
        `Generated client drifted from the IDL: ${drift.join(", ")}`,
      );
    console.log("Generated client matches the committed IDL.");
    return;
  }
  const idl = builtIdl();
  if (mode === "--check") {
    // Compared as parsed JSON: formatting is not drift, content is.
    if (
      !fs.existsSync(COMMITTED_IDL) ||
      canonical(JSON.parse(fs.readFileSync(COMMITTED_IDL, "utf8"))) !== idl
    )
      throw new Error(
        "Committed IDL differs from the Rust program. Run `pnpm --filter @ovelo/contracts idl:sync`.",
      );
    const drift = await generatedDrift();
    if (drift.length)
      throw new Error(
        `Generated client drifted from the IDL: ${drift.join(", ")}`,
      );
    console.log("IDL and generated client match the Rust program.");
    return;
  }
  fs.mkdirSync(path.dirname(COMMITTED_IDL), { recursive: true });
  fs.writeFileSync(COMMITTED_IDL, idl);
  await renderClient(JSON.parse(idl), GENERATED);
  console.log("Updated the v1 IDL and generated client from the Rust program.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
