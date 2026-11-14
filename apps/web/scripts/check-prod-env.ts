// `pnpm check:prod-env [--env-file <path>] [--offline]` (P3). Validates the PRODUCTION profile of
// an env file (or the process env) with the real boot schema plus the launch rules in
// server/prod-env.ts, and asks each mainnet RPC for its genesis hash (read-only). Prints variable
// names and statuses only, never a value. Exit 1 when anything is missing, invalid or forbidden.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  failed,
  genesisFindings,
  report,
  staticFindings,
} from "../server/prod-env";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--env-file");
const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
if (fileIndex >= 0 && !file) {
  process.stderr.write("check:prod-env: --env-file needs a path\n");
  process.exit(2);
}
const env: Record<string, string | undefined> = file
  ? parseEnv(readFileSync(file, "utf8"))
  : { ...process.env };

async function main(): Promise<void> {
  const findings = staticFindings(env);
  if (!args.includes("--offline"))
    findings.push(
      ...(await genesisFindings(env, (url, init) => fetch(url, init))),
    );
  process.stdout.write(
    `check:prod-env (${file ? "env file" : "process env"}; values are never printed)\n${report(findings)}\n`,
  );
  const bad = failed(findings);
  process.stdout.write(`check:prod-env: ${bad ? "FAILED" : "OK"}\n`);
  process.exit(bad ? 1 : 0);
}

void main();
