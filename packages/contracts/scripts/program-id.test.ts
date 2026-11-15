/**
 * The program ID guard (check-program-id.mjs) and its use in build.sh and deploy-devnet.sh:
 * nothing builds or deploys unless the program keypair, declare_id!, Anchor.toml and the built
 * IDLs agree, and a missing keypair is never silently re-created by `anchor build`.
 * The shell scripts run for real in a temporary copy of the workspace with `anchor`, `solana`
 * and `solana-keygen` stubbed (they record each call), so no network and no real key is used.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const SCRIPTS = path.resolve(import.meta.dirname);
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const EXPECTED = "FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU";
const DEPLOYER = "Dep1oyer1111111111111111111111111111111111";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

async function freshKeypair(): Promise<{ bytes: number[]; address: string }> {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const seed = privateKey
    .export({ format: "der", type: "pkcs8" })
    .subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const bytes = [...seed, ...pub];
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  return { bytes, address: signer.address };
}

type Fixture = { root: string; log: string; programId: string };

/**
 * A minimal workspace whose program keypair, declare_id!, Anchor.toml and IDLs all use one
 * fresh ID (unless overridden), plus stub binaries on PATH.
 */
async function fixture(
  o: {
    keypair?: "missing" | "stray" | "corrupt";
    declareId?: string;
    devnetToml?: string;
    idlAfterBuild?: string;
  } = {},
): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovelo-program-id-"));
  dirs.push(root);
  const real = await freshKeypair();
  const id = real.address;
  fs.mkdirSync(path.join(root, "scripts"));
  for (const f of ["check-program-id.mjs", "build.sh", "deploy-devnet.sh"])
    fs.copyFileSync(path.join(SCRIPTS, f), path.join(root, "scripts", f));
  // check-build.mjs inspects real binaries; the stubbed build has none.
  fs.writeFileSync(path.join(root, "scripts/check-build.mjs"), "");
  fs.mkdirSync(path.join(root, "programs/ovelo_guard/src"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "programs/ovelo_guard/src/lib.rs"),
    `use anchor_lang::prelude::*;\n\ndeclare_id!("${o.declareId ?? id}");\n`,
  );
  fs.writeFileSync(
    path.join(root, "Anchor.toml"),
    `[programs.localnet]\novelo_guard = "${id}"\n\n[programs.devnet]\novelo_guard = "${o.devnetToml ?? id}"\n`,
  );
  fs.mkdirSync(path.join(root, "target/deploy"), { recursive: true });
  const keypairFile = path.join(root, "target/deploy/ovelo_guard-keypair.json");
  if (o.keypair === "stray")
    fs.writeFileSync(keypairFile, JSON.stringify((await freshKeypair()).bytes));
  else if (o.keypair === "corrupt")
    fs.writeFileSync(
      keypairFile,
      JSON.stringify([
        ...real.bytes.slice(0, 32),
        ...(await freshKeypair()).bytes.slice(32),
      ]),
    );
  else if (o.keypair !== "missing")
    fs.writeFileSync(keypairFile, JSON.stringify(real.bytes));

  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.log");
  fs.mkdirSync(bin);
  const idl = o.idlAfterBuild ?? id;
  // `anchor build`, like the real one, creates a program keypair when it is missing.
  const stubs: Record<string, string> = {
    anchor: `echo "anchor $*" >> "${log}"
[ -f target/deploy/ovelo_guard-keypair.json ] || echo '[]' > target/deploy/ovelo_guard-keypair.json
mkdir -p target/idl && echo '{"address":"${idl}"}' > target/idl/ovelo_guard.json
touch target/deploy/ovelo_guard.so`,
    solana: `echo "solana $*" >> "${log}"
case "$1" in
  genesis-hash) echo "${DEVNET_GENESIS}" ;;
  balance) echo "6 SOL" ;;
  program) if [ "$2" = show ]; then echo '{"programId":"${id}","authority":"${DEPLOYER}"}'; fi ;;
esac
exit 0`,
    "solana-keygen": `echo "solana-keygen $*" >> "${log}"; echo "${DEPLOYER}"`,
  };
  for (const [name, body] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  fs.writeFileSync(path.join(root, "deployer.json"), "[]");
  return { root, log, programId: id };
}

function run(f: Fixture, script: string, expected = f.programId) {
  // deploy-devnet.sh pins the real program ID; point it at the fixture's ID.
  const file = path.join(f.root, "scripts", script);
  fs.writeFileSync(
    file,
    fs.readFileSync(file, "utf8").replace(EXPECTED, expected),
  );
  const result = spawnSync("bash", [file], {
    cwd: f.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(f.root, "bin")}:${process.env.PATH}`,
      OVELO_DEPLOYER: path.join(f.root, "deployer.json"),
    },
  });
  const calls = fs.existsSync(f.log) ? fs.readFileSync(f.log, "utf8") : "";
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    calls,
  };
}

test("deploy-devnet.sh pins the real program ID, and the checked-in IDs agree", () => {
  const root = path.resolve(SCRIPTS, "..");
  expect(
    fs.readFileSync(path.join(SCRIPTS, "deploy-devnet.sh"), "utf8"),
  ).toContain(`EXPECTED_PROGRAM_ID="${EXPECTED}"`);
  expect(
    fs.readFileSync(path.join(root, "programs/ovelo_guard/src/lib.rs"), "utf8"),
  ).toContain(`declare_id!("${EXPECTED}")`);
  const toml = fs.readFileSync(path.join(root, "Anchor.toml"), "utf8");
  expect(toml.match(/ovelo_guard = "([^"]+)"/g)).toEqual([
    `ovelo_guard = "${EXPECTED}"`,
    `ovelo_guard = "${EXPECTED}"`,
  ]);
});

test("deploy proceeds when keypair, declare_id!, Anchor.toml and IDL agree", async () => {
  const f = await fixture();
  const r = run(f, "deploy-devnet.sh");
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(r.calls).toMatch(/solana program deploy/);
  expect(r.stdout).toContain(`OK: ${f.programId} deployed to devnet`);
});

test.each([
  [
    "a stray program keypair",
    { keypair: "stray" as const },
    /program IDs disagree/,
  ],
  [
    "a program keypair whose halves do not match",
    { keypair: "corrupt" as const },
    /corrupt/,
  ],
  [
    "a missing program keypair",
    { keypair: "missing" as const },
    /is missing.*NEW program keypair/s,
  ],
  ["a different declare_id!", { declareId: EXPECTED }, /program IDs disagree/],
  [
    "a different Anchor.toml entry",
    { devnetToml: EXPECTED },
    /Anchor\.toml \[programs\.devnet\]/,
  ],
])(
  "deploy refuses %s before building or deploying",
  async (_, opts, message) => {
    const f = await fixture(opts);
    const r = run(f, "deploy-devnet.sh");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
    expect(r.stderr).toMatch(/Refusing to deploy/);
    expect(r.calls).not.toMatch(/anchor build/);
    expect(r.calls).not.toMatch(/program deploy/);
  },
);

test("deploy refuses when the built IDL has another address", async () => {
  const f = await fixture({ idlAfterBuild: EXPECTED });
  const r = run(f, "deploy-devnet.sh");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/target\/idl\/ovelo_guard\.json/);
  expect(r.calls).toMatch(/anchor build/);
  expect(r.calls).not.toMatch(/program deploy/);
});

test("deploy refuses a pinned ID that differs from the workspace's", async () => {
  const f = await fixture();
  const r = run(f, "deploy-devnet.sh", EXPECTED);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/expected \(--expect\)/);
  expect(r.calls).not.toMatch(/program deploy/);
});

test("build.sh never lets anchor create a program keypair", async () => {
  const f = await fixture({ keypair: "missing" });
  const r = run(f, "build.sh");
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/ovelo_guard-keypair\.json is missing/);
  expect(r.calls).not.toMatch(/anchor/);
  expect(
    fs.existsSync(path.join(f.root, "target/deploy/ovelo_guard-keypair.json")),
  ).toBe(false);
});

test("build.sh refuses a stray keypair and builds with the right one", async () => {
  const stray = await fixture({ keypair: "stray" });
  const bad = run(stray, "build.sh");
  expect(bad.status).not.toBe(0);
  expect(bad.calls).not.toMatch(/anchor/);

  const good = await fixture();
  const ok = run(good, "build.sh");
  expect(ok.stderr).toBe("");
  expect(ok.status).toBe(0);
  expect(ok.calls.match(/anchor build/g)).toHaveLength(2);
  expect(ok.stdout).toContain(`OK: program ID ${good.programId}`);
});

test("the check never prints secret key bytes", async () => {
  const f = await fixture({ keypair: "stray" });
  const r = run(f, "build.sh");
  const secret = JSON.parse(
    fs.readFileSync(
      path.join(f.root, "target/deploy/ovelo_guard-keypair.json"),
      "utf8",
    ),
  ) as number[];
  const out = r.stdout + r.stderr;
  expect(out).not.toContain(secret.slice(0, 8).join(","));
  expect(out).not.toContain(Buffer.from(secret.slice(0, 32)).toString("hex"));
});
