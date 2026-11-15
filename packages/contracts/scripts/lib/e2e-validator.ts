/** solana-test-validator with the pinned upstream programs, and a real CLI deploy of Ovelo Guard. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { Address } from "@solana/kit";
import { CONTRACTS_ROOT } from "./keys";
import { connect } from "./send";

const PINS = JSON.parse(
  fs.readFileSync(
    path.join(CONTRACTS_ROOT, "tests/fixtures/runtime-programs.json"),
    "utf8",
  ),
) as {
  programs: Record<string, { programId: string; sha256: string }>;
};

export function pinnedSo(name: string): string {
  const file = path.join(CONTRACTS_ROOT, "target/test-programs", `${name}.so`);
  if (!fs.existsSync(file))
    throw new Error(
      `Missing ${name}.so: run \`pnpm --filter @ovelo/contracts test:fixtures\`.`,
    );
  const sha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
  if (sha !== PINS.programs[name]!.sha256)
    throw new Error(`${name}.so is not the pinned binary.`);
  return file;
}

/** Starts a fresh validator (ledger under `work`) and waits until its RPC is healthy. */
export async function startValidator(
  work: string,
  port: number,
  accountArgs: string[],
): Promise<{ child: ChildProcess; c: ReturnType<typeof connect> }> {
  const child = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger",
      path.join(work, "ledger"),
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(port + 1001),
      "--bpf-program",
      PINS.programs.subscriptions!.programId,
      pinnedSo("subscriptions"),
      "--bpf-program",
      PINS.programs.pyth_receiver!.programId,
      pinnedSo("pyth_receiver"),
      ...accountArgs,
    ],
    { stdio: "ignore" },
  );
  const c = connect(`http://127.0.0.1:${port}`);
  for (let i = 0; ; i += 1) {
    try {
      if ((await c.rpc.getHealth().send()) === "ok") break;
    } catch {
      /* still starting */
    }
    if (i > 90) throw new Error("solana-test-validator did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { child, c };
}

/** `solana program deploy`, then `solana program show` must report `authority` as the upgrade authority. */
export function deploy(
  url: string,
  so: string,
  programKeypair: string,
  authorityFile: string,
  authority: Address,
  programId: Address,
) {
  const out = JSON.parse(
    execFileSync(
      "solana",
      [
        "program",
        "deploy",
        "--url",
        url,
        "--keypair",
        authorityFile,
        "--upgrade-authority",
        authorityFile,
        "--program-id",
        programKeypair,
        so,
        "--output",
        "json",
      ],
      { encoding: "utf8" },
    ),
  ) as { signature?: string };
  const shown = JSON.parse(
    execFileSync(
      "solana",
      ["program", "show", programId, "--url", url, "--output", "json"],
      { encoding: "utf8" },
    ),
  ) as { authority: string; programId: string };
  if (shown.programId !== programId || shown.authority !== authority)
    throw new Error(`deploy check failed: ${JSON.stringify(shown)}`);
  return { signature: out.signature ?? "", ...shown };
}

/** The program's "Error Code: X" from a failed send (kit preflight errors carry the logs). */
export function errorCodeOf(error: unknown): string {
  const seen = new Set<unknown>();
  for (
    let e: unknown = error;
    e && !seen.has(e);
    e = (e as { cause?: unknown }).cause
  ) {
    seen.add(e);
    const logs = (e as { context?: { logs?: string[] } }).context?.logs ?? [];
    for (const line of logs) {
      const m = /Error Code: (\w+)/.exec(line);
      if (m) return m[1]!;
    }
  }
  return String((error as Error)?.message ?? error);
}
