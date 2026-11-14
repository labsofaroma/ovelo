#!/usr/bin/env node
/**
 * Client-bundle secret scan (M4 B10; restores the scan the prototype referenced but never
 * committed). After `next build`, every file a browser can receive is searched for:
 *   1. the VALUE of every configured server-side secret (env files and the process environment),
 *      in plain, gzip and brotli artifacts;
 *   2. the NAMES of secret-bearing server variables (a name in a client chunk means server code
 *      was bundled for the browser);
 *   3. E2E-only markers (the test wallet bridge) that must never reach a production build;
 *   4. localnet markers (M7: the test-only localnet wallet cluster) likewise;
 *   5. Solana secret-key material: a JSON array of exactly 64 byte values (M7: keeper and
 *      faucet keys are loaded from env in that shape and must never be bundled).
 * Output names the file and the VARIABLE, never the value. Exit 1 on any finding.
 *
 *   node scripts/check-client-secrets.mjs [--next apps/web/.next] [--allow-e2e] [--allow-localnet]
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "EXPO_PUBLIC_"];
/** Variables whose value is a secret even when the name does not say so. */
const ALWAYS_SECRET = new Set([
  "DATABASE_URL",
  "BOT_KEYPAIR",
  "CREATOR_INVITE_CODES",
  "AROMA_FAUCET_SECRET_KEY",
  "AROMA_V1_FAUCET_KEYPAIR",
  "KEEPER_KEYPAIR",
]);
const SECRET_NAME =
  /(SECRET|TOKEN|PASSWORD|PRIVATE|KEYPAIR|API_KEYS?|SIGNING_KEY|AUTH_UUID|INVITE)/;
/** Never secrets, even if a pattern matched. */
const NOT_SECRET = new Set(["NODE_ENV", "LOG_LEVEL", "VERCEL_ENV"]);
const MIN_LENGTH = 8;

/** Names whose mere presence in a client artifact is a leak (server-only, secret-bearing). */
export const FORBIDDEN_NAMES = [
  "AROMA_TRADE_SECRET",
  "AROMA_TRADE_SECRET_PREVIOUS",
  "AROMA_REVALIDATE_SECRET",
  "AROMA_RECURRING_AUTH_SECRET",
  "AROMA_RECURRING_EXECUTOR_SECRET",
  "AROMA_FAUCET_SECRET_KEY",
  "CREATOR_AUTH_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "DATABASE_URL",
  "PRIVY_APP_SECRET",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "SENTRY_AUTH_TOKEN",
  "JITO_AUTH_UUID",
  "AROMA_V1_FAUCET_KEYPAIR",
  "TURNSTILE_SECRET_KEY",
  "KEEPER_KEYPAIR",
  "PYTH_API_KEY",
];
/** E2E-only code that must be compiled out of production builds. */
export const E2E_MARKERS = ["aromaE2EWallet"];
/** Localnet-only wallet code (features/wallet/cluster.ts) that must be compiled out likewise. */
export const LOCALNET_MARKERS = ["aromaLocalnetCluster"];
/** A JSON array of exactly 64 integers in 0..255: the shape of a Solana secret key file. */
const KEY_ARRAY =
  /\[\s*(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*){63}(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\]/;

/** True when `text` contains secret-key-shaped material (exported for tests). */
export function containsKeyMaterial(text) {
  return KEY_ARRAY.test(text);
}

function isSecretName(name) {
  if (PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  if (NOT_SECRET.has(name)) return false;
  return ALWAYS_SECRET.has(name) || SECRET_NAME.test(name);
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

/**
 * Map of secret VALUE → variable names holding it. Comma-separated values (rotating API keys,
 * invitation lists) contribute each part. Values equal to a public variable's value are not
 * secrets (e.g. a public RPC URL used on both sides).
 */
export async function configuredServerSecrets({
  envFiles = [],
  environment = process.env,
} = {}) {
  const merged = {};
  for (const file of envFiles)
    if (existsSync(file))
      Object.assign(merged, parseEnvFile(await readFile(file, "utf8")));
  Object.assign(merged, environment);
  const publicValues = new Set(
    Object.entries(merged)
      .filter(([name]) => PUBLIC_PREFIXES.some((p) => name.startsWith(p)))
      .map(([, value]) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const secrets = new Map();
  for (const [name, raw] of Object.entries(merged)) {
    if (!isSecretName(name) || typeof raw !== "string") continue;
    for (const part of [raw.trim(), ...raw.split(",").map((p) => p.trim())]) {
      if (part.length < MIN_LENGTH || publicValues.has(part)) continue;
      const names = secrets.get(part) ?? [];
      if (!names.includes(name)) names.push(name);
      secrets.set(part, names);
    }
  }
  return secrets;
}

const TEXT = /\.(js|mjs|cjs|css|html|json|map|rsc|txt|body|meta)$/;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

async function contents(path) {
  const bytes = await readFile(path);
  if (path.endsWith(".gz")) return gunzipSync(bytes).toString("utf8");
  if (path.endsWith(".br")) return brotliDecompressSync(bytes).toString("utf8");
  return TEXT.test(path) ? bytes.toString("utf8") : null;
}

/**
 * Scan directories. `matches` lists files with the variables (or markers) found in them; secret
 * values are never included in the result.
 */
export async function scanClientArtifacts(
  dirs,
  secrets,
  { forbiddenNames = [], markers = [], keyMaterial = false } = {},
) {
  const matches = [];
  let scannedFiles = 0;
  for (const dir of dirs) {
    if (!existsSync(dir) || !(await stat(dir)).isDirectory()) continue;
    for await (const path of files(dir)) {
      const text = await contents(path).catch(() => null);
      if (text === null) continue;
      scannedFiles += 1;
      const variables = new Set();
      for (const [value, names] of secrets)
        if (text.includes(value)) names.forEach((n) => variables.add(n));
      const found = [
        ...forbiddenNames
          .filter((name) => new RegExp(`\\b${name}\\b`).test(text))
          .map((n) => `name:${n}`),
        ...markers
          .filter((marker) => text.includes(marker))
          .map((m) => `marker:${m}`),
        ...(keyMaterial && containsKeyMaterial(text) ? ["key-material"] : []),
      ];
      if (variables.size || found.length)
        matches.push({ file: path, variables: [...variables].sort(), found });
    }
  }
  return { scannedFiles, matches };
}

/** Everything a browser can download from a Next build: static chunks and prerendered output. */
export function clientArtifactDirs(nextDir) {
  return [join(nextDir, "static"), join(nextDir, "server", "app")];
}

async function main() {
  const args = process.argv.slice(2);
  const nextArg = args.indexOf("--next");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const nextDir = resolve(
    nextArg >= 0 ? args[nextArg + 1] : join(root, "apps/web/.next"),
  );
  const allowE2E =
    args.includes("--allow-e2e") ||
    process.env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true";
  const allowLocalnet =
    args.includes("--allow-localnet") ||
    process.env.NEXT_PUBLIC_AROMA_LOCALNET === "true";
  if (!existsSync(nextDir)) {
    console.error(
      `check-client-secrets: ${nextDir} does not exist; run next build first.`,
    );
    process.exit(2);
  }
  const web = join(root, "apps/web");
  const secrets = await configuredServerSecrets({
    envFiles: [
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ].map((f) => join(web, f)),
  });
  // Server prerender output (.next/server/app) contains server-only markup paths too; scan only
  // what is served: HTML, RSC payloads and static chunks.
  const result = await scanClientArtifacts(
    clientArtifactDirs(nextDir),
    secrets,
    {
      forbiddenNames: FORBIDDEN_NAMES,
      markers: [
        ...(allowE2E ? [] : E2E_MARKERS),
        ...(allowLocalnet ? [] : LOCALNET_MARKERS),
      ],
      keyMaterial: true,
    },
  );
  const served = result.matches.filter(
    (m) =>
      m.file.includes(`${join("static")}`) || /\.(html|rsc|body)$/.test(m.file),
  );
  if (served.length) {
    console.error(
      `check-client-secrets: FAIL. ${served.length} client artifact(s) expose server data:`,
    );
    for (const m of served)
      console.error(
        `  - ${relative(root, m.file)}: ${[...m.variables, ...m.found].join(", ")}`,
      );
    process.exit(1);
  }
  console.log(
    `check-client-secrets: OK. ${result.scannedFiles} files scanned, ${secrets.size} configured secret value(s), ` +
      `${FORBIDDEN_NAMES.length} forbidden names, E2E markers ${allowE2E ? "allowed (E2E build)" : "forbidden"}, ` +
      `localnet markers ${allowLocalnet ? "allowed (localnet test build)" : "forbidden"}, key material forbidden.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
