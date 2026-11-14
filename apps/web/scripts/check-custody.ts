// `pnpm check:custody --cluster devnet|mainnet [--rpc URL] [--program ID]
//   [--expect-upgrade-authority ADDR] [--expect-admin ADDR] [--expect-keeper ADDR] [--require-deployed]`
// P4 / M10: read-only. Prints the v1 program's upgrade authority, config admin and keeper and
// compares each with the expected value (the Squads vault at M10). Never signs or sends.
import {
  checkCustody,
  custodyFailed,
  formatCustody,
  type Cluster,
} from "../server/custody";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const clusterArg = flag("--cluster");
if (clusterArg !== "devnet" && clusterArg !== "mainnet") {
  process.stderr.write("check:custody: --cluster devnet|mainnet is required\n");
  process.exit(2);
}
const cluster: Cluster = clusterArg;
const url =
  flag("--rpc") ??
  (cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com");

const rpc = async <T>(method: string, params: unknown[] = []): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (body.error || !("result" in body))
    throw new Error(`RPC ${method} failed`);
  return body.result as T;
};

async function main(): Promise<void> {
  const report = await checkCustody(rpc, {
    cluster,
    programId: flag("--program"),
    expect: {
      upgradeAuthority: flag("--expect-upgrade-authority"),
      admin: flag("--expect-admin"),
      keeper: flag("--expect-keeper"),
    },
  });
  process.stdout.write(
    `check:custody (${cluster}, read-only)\n${formatCustody(report)}\n`,
  );
  const bad = custodyFailed(report, args.includes("--require-deployed"));
  process.stdout.write(`check:custody: ${bad ? "FAILED" : "OK"}\n`);
  process.exit(bad ? 1 : 0);
}

main().catch(() => {
  process.stderr.write("check:custody: RPC unreachable or not JSON-RPC\n");
  process.exit(1);
});
