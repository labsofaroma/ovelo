/**
 * M7 E2E on a LOCAL VALIDATOR (`pnpm --filter @aroma/web e2e:invest`). Nothing here touches
 * devnet or mainnet: every key is generated at runtime, every service is on 127.0.0.1.
 *
 * 1. Docker Postgres + Neon wsproxy (reset, migrated) and Docker Redis behind an Upstash REST proxy.
 * 2. The localnet chain (packages/contracts/scripts/e2e-invest-chain.ts): validator, Aroma Guard
 *    v1, Subscriptions, Pyth receiver + Wormhole with a test guardian, a fake Hermes.
 * 3. A local alert webhook sink.
 * 4. The app built with the E2E wallet bridge and the localnet cluster into .next-e2e-invest, the
 *    client-secret scan on that build, then `next start`.
 * 5. The keeper (apps/keeper) on localnet, its log in .e2e-invest/keeper.log.
 * 6. Playwright e2e/invest/*.spec.ts, then the keeper log evidence and teardown.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createWriteStream,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const WEB = process.cwd();
const ROOT = join(WEB, "../..");
const WORK = join(ROOT, ".e2e-invest");
const APP_PORT = 3300;
const KEEPER_PORT = 8790;
const SINK_PORT = 4030;
const DIST = ".next-e2e-invest";
const REDIS = {
  url: "http://127.0.0.1:8079",
  token: "aroma-local-redis-token",
};
const DB = {
  url: "postgres://aroma:aroma-local-only@127.0.0.1:54329/aroma",
  proxy: "127.0.0.1:54330",
};
const children: ChildProcess[] = [];
const log = (m: string) => process.stdout.write(`[e2e:invest] ${m}\n`);

function start(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd = WEB,
  logFile?: string,
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: logFile ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (logFile) {
    const out = createWriteStream(logFile);
    child.stdout?.pipe(out);
    child.stderr?.pipe(out);
  }
  children.push(child);
  return child;
}

const wait = (
  cmd: string,
  args: string[],
  env: Record<string, string>,
  cwd = WEB,
) =>
  new Promise<number>((resolve) =>
    start(cmd, args, env, cwd).on("exit", (code) => resolve(code ?? 1)),
  );

async function until(
  what: string,
  check: () => Promise<boolean>,
  seconds = 180,
): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${what} did not become ready`);
}

async function chain(): Promise<string> {
  rmSync(WORK, { recursive: true, force: true });
  const child = start(
    "npx",
    ["vite-node", "scripts/e2e-invest-chain.ts", "--work", WORK],
    {},
    join(ROOT, "packages/contracts"),
  );
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => reject(new Error(`chain exited ${code}`)));
    const poll = setInterval(() => {
      try {
        readFileSync(join(WORK, "state.json"));
        clearInterval(poll);
        resolve(join(WORK, "state.json"));
      } catch {
        /* not yet */
      }
    }, 1000);
  });
}

function alertSink() {
  const alerts: unknown[] = [];
  createServer((req, res) => {
    if (req.method === "GET") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(alerts));
      return;
    }
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      alerts.push(JSON.parse(body || "{}"));
      writeFileSync(join(WORK, "alerts.json"), JSON.stringify(alerts, null, 2));
      res.writeHead(200).end("ok");
    });
  }).listen(SINK_PORT, "127.0.0.1");
}

async function main() {
  execFileSync("scripts/local-db.sh", ["reset"], { stdio: "inherit" });
  execFileSync("scripts/local-redis.sh", ["up"], { stdio: "inherit" });
  await fetch(REDIS.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS.token}`,
      "Content-Type": "application/json",
    },
    body: '["FLUSHALL"]',
  });
  const statePath = await chain();
  const s = JSON.parse(readFileSync(statePath, "utf8")) as {
    rpcUrl: string;
    genesis: string;
    testUsd: string;
    hermesUrl: string;
    keeper: { secret: number[] };
    faucet: { secret: number[] };
  };
  log(`chain ready: ${s.rpcUrl} genesis ${s.genesis}`);
  alertSink();
  const placeholders = Object.fromEntries(
    readFileSync(join(WEB, ".env.example"), "utf8")
      .split("\n")
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => Boolean(m && m[2]))
      .map((m) => [m[1]!, m[2]!]),
  );
  const buildEnv = {
    ...placeholders,
    NEXT_PUBLIC_AROMA_E2E_WALLET: "true",
    NEXT_PUBLIC_AROMA_LOCALNET: "true",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    AROMA_NEXT_DIST_DIR: DIST,
  };
  if (process.env.E2E_SKIP_BUILD !== "1") {
    const tracked = ["tsconfig.json", "next-env.d.ts"].map((f) => ({
      f,
      text: readFileSync(join(WEB, f), "utf8"),
    }));
    const built = await wait("npx", ["next", "build"], buildEnv);
    for (const { f, text } of tracked) writeFileSync(join(WEB, f), text);
    if (built !== 0) throw new Error("next build failed");
    if (
      (await wait(
        "node",
        [
          "../../scripts/check-client-secrets.mjs",
          "--next",
          DIST,
          "--allow-e2e",
          "--allow-localnet",
        ],
        buildEnv,
      )) !== 0
    )
      throw new Error("client-secret scan failed on the E2E build");
  }
  const tradeSecret = randomBytes(24).toString("hex");
  const signing = {
    current: `sig_${randomBytes(16).toString("hex")}`,
    next: `sig_${randomBytes(16).toString("hex")}`,
  };
  start(
    "npx",
    ["next", "start", "-p", String(APP_PORT)],
    {
      ...buildEnv,
      NODE_ENV: "production",
      AROMA_V1_ALLOW_TEST_SWITCHES: "true",
      AROMA_V1_INVEST_CLUSTER: "localnet",
      AROMA_V1_LOCALNET_RPC_URL: s.rpcUrl,
      AROMA_V1_LOCALNET_GENESIS: s.genesis,
      AROMA_V1_LOCALNET_FUNDING_MINT: s.testUsd,
      AROMA_V1_FAUCET_KEYPAIR: JSON.stringify(s.faucet.secret),
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      AROMA_TRADE_SECRET: tradeSecret,
      DATABASE_URL: DB.url,
      AROMA_LOCAL_NEON_WS_PROXY: DB.proxy,
      UPSTASH_REDIS_REST_URL: REDIS.url,
      UPSTASH_REDIS_REST_TOKEN: REDIS.token,
      LOG_LEVEL: "info",
      // M9's compliance gate blocks devnet plans and the faucet without a TRUSTED country (fail
      // closed). As in the trade E2E, the app trusts the proxy headers and the browser sends an
      // allowed country (invest.config.ts). Found in Phase A: the faucet claim was geo-refused.
      AROMA_TRUST_PROXY: "true",
    },
    WEB,
    join(WORK, "web.log"),
  );
  await until(
    "next start",
    async () => (await fetch(`http://127.0.0.1:${APP_PORT}/invest`)).ok,
  );
  start(
    "npx",
    ["tsx", "src/server.ts"],
    {
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      KEEPER_CLUSTER: "localnet",
      KEEPER_ALLOW_LOCALNET: "true",
      KEEPER_LOCALNET_GENESIS: s.genesis,
      KEEPER_RPC_URL: s.rpcUrl,
      KEEPER_KEYPAIR: JSON.stringify(s.keeper.secret),
      QSTASH_CURRENT_SIGNING_KEY: signing.current,
      QSTASH_NEXT_SIGNING_KEY: signing.next,
      KEEPER_PUBLIC_URL: `http://127.0.0.1:${KEEPER_PORT}/run`,
      HERMES_URL: s.hermesUrl,
      UPSTASH_REDIS_REST_URL: REDIS.url,
      UPSTASH_REDIS_REST_TOKEN: REDIS.token,
      DATABASE_URL: DB.url,
      AROMA_LOCAL_NEON_WS_PROXY: DB.proxy,
      KEEPER_ALERT_WEBHOOK_URL: `http://127.0.0.1:${SINK_PORT}/alerts`,
      KEEPER_PORT: String(KEEPER_PORT),
      KEEPER_MIN_SOL_LAMPORTS: "1000000000",
    },
    join(ROOT, "apps/keeper"),
    join(WORK, "keeper.log"),
  );
  await until(
    "keeper",
    async () => (await fetch(`http://127.0.0.1:${KEEPER_PORT}/health`)).ok,
  );
  log("app and keeper ready; running Playwright");
  const code = await wait(
    "npx",
    [
      "playwright",
      "test",
      "-c",
      "e2e/invest.config.ts",
      ...process.argv.slice(2),
    ],
    {
      E2E_INVEST_STATE: statePath,
      E2E_BASE_URL: `http://127.0.0.1:${APP_PORT}`,
      E2E_KEEPER_URL: `http://127.0.0.1:${KEEPER_PORT}/run`,
      E2E_QSTASH_KEY: signing.current,
      E2E_ALERTS_URL: `http://127.0.0.1:${SINK_PORT}/alerts`,
      E2E_REDIS_URL: REDIS.url,
      E2E_REDIS_TOKEN: REDIS.token,
    },
  );
  const keeperLog = readFileSync(join(WORK, "keeper.log"), "utf8").split("\n");
  const evidence = keeperLog.filter((l) =>
    /lease|installment executed|dead-lettered|keeper alert|keeper run finished|drift/.test(
      l,
    ),
  );
  writeFileSync(join(WORK, "keeper-evidence.log"), evidence.join("\n"));
  log(
    `keeper log evidence (${evidence.length} lines) in .e2e-invest/keeper-evidence.log`,
  );
  process.exitCode = code;
}

function teardown() {
  for (const child of children.reverse()) child.kill("SIGTERM");
}
process.on("exit", teardown);
process.on("SIGINT", () => {
  teardown();
  process.exit(130);
});

main()
  .catch((error: Error) => {
    log(`FAILED: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    teardown();
    setTimeout(() => process.exit(process.exitCode ?? 0), 2_000);
  });
