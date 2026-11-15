// `pnpm check:prod-env [--env-file <path>] [--offline] [--profile production|beta]
//   [--platform vercel|selfhost]` (P3; --platform: Phase H, default vercel). The
// production profile (default; M9 public launch, server/prod-env.public.ts) and the beta profile
// (Phase A, server/prod-env.beta.ts) both start from the shared production checks. Validates
// an env file (or the process env) with the real boot schema plus the launch rules in
// server/prod-env.ts, and asks each mainnet RPC for its genesis hash (read-only). Prints variable
// names and statuses only, never a value. Exit 1 when anything is missing, invalid or forbidden.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  failed,
  genesisFindings,
  platformFindings,
  report,
  staticFindings,
} from "../server/prod-env";
import { betaFindings } from "../server/prod-env.beta";
import { publicLaunchFindings } from "../server/prod-env.public";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--env-file");
const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
if (fileIndex >= 0 && !file) {
  process.stderr.write("check:prod-env: --env-file needs a path\n");
  process.exit(2);
}
const profileIndex = args.indexOf("--profile");
const profileArg = profileIndex >= 0 ? args[profileIndex + 1] : "production";
if (profileArg !== "production" && profileArg !== "beta") {
  process.stderr.write("check:prod-env: --profile is production or beta\n");
  process.exit(2);
}
const profile: "production" | "beta" = profileArg;
const platformIndex = args.indexOf("--platform");
const platformArg = platformIndex >= 0 ? args[platformIndex + 1] : "vercel";
if (platformArg !== "vercel" && platformArg !== "selfhost") {
  process.stderr.write("check:prod-env: --platform is vercel or selfhost\n");
  process.exit(2);
}
const platform: "vercel" | "selfhost" = platformArg;
const env: Record<string, string | undefined> = file
  ? parseEnv(readFileSync(file, "utf8"))
  : { ...process.env };

async function main(): Promise<void> {
  const findings = staticFindings(env, platform);
  findings.push(...platformFindings(env, platform, profile));
  findings.push(
    ...(profile === "beta" ? betaFindings(env) : publicLaunchFindings(env)),
  );
  if (!args.includes("--offline"))
    findings.push(
      ...(await genesisFindings(env, (url, init) => fetch(url, init))),
    );
  process.stdout.write(
    `check:prod-env (${profile} profile, ${platform}, ${file ? "env file" : "process env"}; values are never printed)\n${report(findings)}\n`,
  );
  const bad = failed(findings);
  process.stdout.write(`check:prod-env: ${bad ? "FAILED" : "OK"}\n`);
  process.exit(bad ? 1 : 0);
}

void main();
