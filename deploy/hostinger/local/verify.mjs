// Phase H Step 8: verify the IMAGE like production, locally (test harness; never on the VPS).
//   node deploy/hostinger/local/verify.mjs [--image aroma-web:local]      (from the repo root)
// Runs the production compose file + compose.local.yml (the Cloudflare stand-in in place of the
// tunnel, and the attacker's direct path to the origin), twice:
//   beta mode (production rules): read-only FS, security headers, the route table with the origin
//     lock (every route, every method), the spoofing suite on the direct path, the public health
//     body, logs without secrets or IPs, the SIGTERM drain, image size and cold start;
//   dev mode (test switches, local rate limiter): spoofed CF-IPCountry / x-vercel-ip-country and
//     X-Forwarded-For through the stand-in change neither the country nor the rate-limit key.
// Prints one line per check and a JSON summary; exits 1 on any failure.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const IMAGE = arg("--image") ?? "aroma-web:local";
const EDGE = Number(process.env.AROMA_LOCAL_EDGE_PORT ?? 3201);
const DIRECT = Number(process.env.AROMA_LOCAL_DIRECT_PORT ?? 3299);
const HOST = "beta.aroma.test";
const work = mkdtempSync(join(tmpdir(), "aroma-verify-"));
const secret = randomBytes(36).toString("base64url");
const secretFile = join(work, "origin");
writeFileSync(secretFile, secret, { mode: 0o644 });
const results = [];
const facts = {};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`,
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Placeholder env from .env.example (connects to nothing), plus the mode's platform answer. */
function envFile(mode) {
  const lines = readFileSync(join(ROOT, "apps/web/.env.example"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .filter(
      (l) =>
        !/^(AROMA_PLATFORM|AROMA_DEPLOY_ENV|AROMA_PROXY_MODE|AROMA_ORIGIN_SECRET|NODE_ENV|NEXT_PUBLIC_AROMA_E2E_WALLET|AROMA_V1_ALLOW_TEST_SWITCHES)=/.test(
          l,
        ),
    );
  lines.push(
    "AROMA_PLATFORM=selfhost",
    `AROMA_DEPLOY_ENV=${mode === "beta" ? "beta" : "development"}`,
    "AROMA_PROXY_MODE=cloudflare",
    `AROMA_ORIGIN_SECRET=${secret}`,
    "AROMA_MAX_TRADE_USDC_RAW=50000000",
    "AROMA_MAX_DAILY_USDC_RAW=200000000",
    `AROMA_SITE_URL=https://${HOST}`,
    `AROMA_V1_ALLOW_TEST_SWITCHES=${mode === "beta" ? "false" : "true"}`,
  );
  const file = join(work, `${mode}.env`);
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  return file;
}

function compose(envPath, ...args) {
  return spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "deploy/hostinger/docker-compose.yml",
      "-f",
      "deploy/hostinger/compose.local.yml",
      ...args,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        AROMA_IMAGE: IMAGE,
        AROMA_LOCAL_ENV_FILE: envPath,
        AROMA_LOCAL_SECRET_FILE: secretFile,
        AROMA_LOCAL_EDGE_HOST: HOST,
      },
    },
  );
}

async function up(mode) {
  const envPath = envFile(mode);
  compose(envPath, "down", "--volumes", "--remove-orphans");
  const started = Date.now();
  const r = compose(
    envPath,
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "120",
    "app",
    "edge",
  );
  if (r.status !== 0)
    throw new Error(`compose up (${mode}) failed: ${r.stderr.slice(-800)}`);
  // `--wait` returns once the stand-in runs; wait until its published port answers too.
  for (let i = 0; i < 120; i++) {
    const ok = await edge("/api/v1/health/live").then(
      (x) => x.ok,
      () => false,
    );
    if (ok) break;
    await sleep(250);
  }
  return { envPath, coldStartMs: Date.now() - started };
}

const edge = (path, init = {}) =>
  fetch(`http://127.0.0.1:${EDGE}${path}`, { redirect: "manual", ...init });
const direct = (path, init = {}) =>
  fetch(`http://127.0.0.1:${DIRECT}${path}`, { redirect: "manual", ...init });
const codeOf = async (r) => {
  try {
    return (await r.clone().json()).code;
  } catch {
    return undefined;
  }
};

/** Every page and route under apps/web/app with a sample URL and its methods (like route-gates). */
function routes() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "apps/web/app"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter((f) =>
      /\/(page|route)\.tsx?$|^apps\/web\/app\/(robots|sitemap)\.ts$/.test(f),
    );
  const sample = {
    id: "sol-core",
    symbol: "AAPLx",
    wallet: "11111111111111111111111111111111",
    pda: "11111111111111111111111111111111",
    channel: "telegram",
  };
  return files.map((f) => {
    const special = /app\/(robots|sitemap)\.ts$/.exec(f);
    let url = special
      ? `/${special[1] === "robots" ? "robots.txt" : "sitemap.xml"}`
      : f
          .replace(/^apps\/web\/app/, "")
          .replace(/\/\([^)]+\)/g, "")
          .replace(/\/(page|route)\.tsx?$/, "") || "/";
    url = url.replace(/\[([^\]]+)\]/g, (_, k) => sample[k] ?? "x");
    let methods = ["GET"];
    if (/route\.tsx?$/.test(f)) {
      const src = readFileSync(join(ROOT, f), "utf8");
      methods = ["GET", "POST", "PUT", "DELETE"].filter((m) =>
        new RegExp(
          `export (async )?function ${m}\\b|export const ${m}\\b`,
        ).test(src),
      );
    }
    return { file: f, url, methods };
  });
}

async function betaSuite() {
  const { envPath, coldStartMs } = await up("beta");
  facts.coldStartMsComposeUpToHealthy = coldStartMs;
  const id = compose(envPath, "ps", "-q", "app").stdout.trim();
  // 1. read-only and identity
  const inspect = JSON.parse(
    execFileSync("docker", ["inspect", id], { encoding: "utf8" }),
  )[0];
  check(
    "read-only root filesystem",
    inspect.HostConfig.ReadonlyRootfs === true,
  );
  check("non-root UID 10001", inspect.Config.User === "10001:10001");
  check(
    "all capabilities dropped",
    JSON.stringify(inspect.HostConfig.CapDrop) === '["ALL"]',
  );
  check(
    "no-new-privileges",
    (inspect.HostConfig.SecurityOpt ?? []).includes("no-new-privileges:true"),
  );
  const write = (p) =>
    spawnSync("docker", ["exec", id, "sh", "-c", `touch ${p} 2>&1`], {
      encoding: "utf8",
    });
  check(
    "cannot write to /app",
    write("/app/x").status !== 0,
    write("/app/x").stdout.trim(),
  );
  check("can write /tmp (tmpfs)", write("/tmp/x").status === 0);
  check(
    "can write .next/cache (volume)",
    write("/app/apps/web/.next/cache/x").status === 0,
  );
  // 2. headers through the edge
  const a = await edge("/terms");
  const b = await edge("/terms");
  const csp = a.headers.get("content-security-policy") ?? "";
  const nonce = (r) =>
    /'nonce-([^']+)'/.exec(r.headers.get("content-security-policy") ?? "")?.[1];
  check("page 200 through the edge", a.status === 200, String(a.status));
  check("CSP with a nonce", Boolean(nonce(a)));
  check("a fresh nonce per request", nonce(a) && nonce(a) !== nonce(b));
  check("CSP frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
  check(
    "HSTS two years + preload (production rules, https, public host)",
    a.headers.get("strict-transport-security") ===
      "max-age=63072000; includeSubDomains; preload",
    a.headers.get("strict-transport-security") ?? "missing",
  );
  check("X-Frame-Options DENY", a.headers.get("x-frame-options") === "DENY");
  check("nosniff", a.headers.get("x-content-type-options") === "nosniff");
  check(
    "Referrer-Policy",
    a.headers.get("referrer-policy") === "strict-origin-when-cross-origin",
  );
  check(
    "Permissions-Policy",
    (a.headers.get("permissions-policy") ?? "").includes("camera=()"),
  );
  check("no X-Powered-By", !a.headers.get("x-powered-by"));
  const api = await edge("/api/v1/health");
  check(
    "API: CSP and no-store",
    Boolean(api.headers.get("content-security-policy")) &&
      (api.headers.get("cache-control") ?? "").includes("no-store"),
  );
  const body = await api.text();
  check(
    "public health body has statuses only",
    !/latency|slot|lag|keyed|httpStatus/.test(body),
    body.slice(0, 160),
  );
  // 3. the route table with the origin lock
  const table = routes();
  let refused = 0;
  let passed = 0;
  const failures = [];
  for (const r of table)
    for (const method of r.methods) {
      const init = {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }),
      };
      const noSecret = await direct(r.url, init);
      const wrong = await direct(r.url, {
        ...init,
        headers: { ...init.headers, "x-aroma-origin": `${secret}x` },
      });
      const viaEdge = await edge(r.url, init);
      const ok =
        noSecret.status === 403 &&
        (await codeOf(noSecret)) === "ORIGIN_REFUSED" &&
        wrong.status === 403 &&
        (await codeOf(wrong)) === "ORIGIN_REFUSED" &&
        (await codeOf(viaEdge)) !== "ORIGIN_REFUSED";
      if (ok) {
        refused += 2;
        passed++;
      } else
        failures.push(
          `${method} ${r.url} direct=${noSecret.status} edge=${viaEdge.status}`,
        );
    }
  facts.routeTable = { routes: table.length, rows: passed + failures.length };
  check(
    `origin lock: every route and method refused directly, served via the edge (${passed} rows)`,
    failures.length === 0,
    failures.slice(0, 5).join("; "),
  );
  // 4. spoofing on the direct path (an attacker who found the origin)
  const forged = {
    "cf-connecting-ip": "6.6.6.6",
    "cf-ipcountry": "DE",
    "x-vercel-ip-country": "DE",
    "x-forwarded-for": "6.6.6.6",
    "x-real-ip": "6.6.6.6",
    "true-client-ip": "6.6.6.6",
    "x-forwarded-proto": "https",
    "cf-visitor": '{"scheme":"https"}',
    host: HOST,
  };
  for (const [method, path] of [
    ["GET", "/markets"],
    ["POST", "/api/v1/trade/quote"],
    ["POST", "/api/v1/actions/baskets/sol-core?amount=1"],
    ["GET", "/actions.json"],
    ["POST", "/api/v1/notifications/deliver"],
    ["GET", "/_next/image?url=%2Fxstocks-devnet%2FxGOOGL.png&w=64&q=75"],
    ["GET", "/api/v1/health/live"],
  ]) {
    const r = await direct(path, {
      method,
      headers: { ...forged, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
    check(
      `spoof direct ${method} ${path.split("?")[0]}: forged CF and forwarding headers, no secret → 403`,
      r.status === 403,
      String(r.status),
    );
  }
  // 5. the image optimizer and public files still work through the edge
  const img = await edge(
    "/_next/image?url=%2Fxstocks-devnet%2FxGOOGL.png&w=64&q=75",
    { headers: { accept: "image/webp" } },
  );
  check(
    "image optimizer through the edge (sharp)",
    img.status === 200 &&
      (img.headers.get("content-type") ?? "").startsWith("image/"),
    `${img.status} ${img.headers.get("content-type")}`,
  );
  // 6. logs: no secret, no client IP
  const logs = compose(envPath, "logs", "--no-color", "app").stdout;
  check("logs carry no origin secret", !logs.includes(secret));
  check("logs carry no client IP", !/6\.6\.6\.6|203\.0\.113\./.test(logs));
  check(
    "logs are JSON lines (app logger)",
    logs.split("\n").some((l) => l.includes('"level"')),
  );
  // 7. drain on SIGTERM with a request in flight
  const inflight = edge("/api/v1/health").then(
    (r) => r.status,
    () => "cut",
  );
  await sleep(150);
  const t0 = Date.now();
  compose(envPath, "stop", "-t", "75", "app");
  facts.stopMs = Date.now() - t0;
  const exit = JSON.parse(
    execFileSync("docker", ["inspect", id], { encoding: "utf8" }),
  )[0].State.ExitCode;
  const drainLogs = compose(envPath, "logs", "--no-color", "app").stdout;
  check(
    "SIGTERM: in-flight request answered",
    typeof (await inflight) === "number",
    String(await inflight),
  );
  check(
    "SIGTERM: exit 0 after the drain",
    exit === 0,
    `exit ${exit}, ${facts.stopMs} ms`,
  );
  check(
    "SIGTERM: drain and pool close logged",
    /shutdown: draining/.test(drainLogs) && /shutdown: closed/.test(drainLogs),
  );
  // 8. cold start of the container alone (start → healthy)
  const t1 = Date.now();
  compose(envPath, "start", "app");
  for (let i = 0; i < 120; i++) {
    const s = JSON.parse(
      execFileSync("docker", ["inspect", id], { encoding: "utf8" }),
    )[0].State;
    if (s.Health?.Status === "healthy") break;
    await sleep(250);
  }
  facts.coldStartMsStartToHealthy = Date.now() - t1;
  const live = await edge("/api/v1/health/live");
  check(
    "restart: healthy and serving again",
    live.status === 200,
    `${facts.coldStartMsStartToHealthy} ms`,
  );
  facts.idleMemory = execFileSync(
    "docker",
    ["stats", "--no-stream", "--format", "{{.MemUsage}}", id],
    { encoding: "utf8" },
  ).trim();
  compose(envPath, "down", "--volumes", "--remove-orphans");
}

async function devSuite() {
  const { envPath } = await up("dev");
  const quote = (headers) =>
    edge("/api/v1/trade/quote", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    });
  const us = await quote({
    "x-edge-client-country": "US",
    "x-edge-client-ip": "203.0.113.10",
    "cf-ipcountry": "DE",
    "x-vercel-ip-country": "DE",
  });
  check(
    "spoof via edge: a US client sending CF-IPCountry/x-vercel DE is still refused (451)",
    us.status === 451,
    `${us.status} ${await codeOf(us)}`,
  );
  const de = await quote({
    "x-edge-client-country": "DE",
    "x-edge-client-ip": "203.0.113.11",
    "cf-ipcountry": "US",
    "x-vercel-ip-country": "US",
  });
  check(
    "spoof via edge: a DE client sending US headers is not geo-refused",
    de.status !== 451,
    `${de.status} ${await codeOf(de)}`,
  );
  const tor = await quote({
    "x-edge-client-country": "T1",
    "x-edge-client-ip": "203.0.113.12",
  });
  check("Tor (T1) fails closed (451)", tor.status === 451, String(tor.status));
  // Rate limit key = CF-Connecting-IP only: rotating forwarding headers from ONE client hits 429.
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const r = await quote({
      "x-edge-client-country": "DE",
      "x-edge-client-ip": "203.0.113.20",
      "x-forwarded-for": `198.51.100.${i}`,
      "x-real-ip": `198.51.100.${i}`,
      "true-client-ip": `198.51.100.${i}`,
    });
    statuses.push(r.status);
  }
  check(
    "spoofed X-Forwarded-For/X-Real-IP/True-Client-IP cannot escape the rate limit",
    statuses.includes(429),
    statuses.join(","),
  );
  const distinct = [];
  for (let i = 0; i < 12; i++)
    distinct.push(
      (
        await quote({
          "x-edge-client-country": "DE",
          "x-edge-client-ip": `203.0.113.${100 + i}`,
        })
      ).status,
    );
  check(
    "distinct CF-Connecting-IP clients each get their own bucket",
    !distinct.includes(429),
    distinct.join(","),
  );
  compose(envPath, "down", "--volumes", "--remove-orphans");
}

try {
  const size = execFileSync(
    "docker",
    ["image", "inspect", IMAGE, "-f", "{{.Size}}"],
    { encoding: "utf8" },
  ).trim();
  facts.imageBytesUncompressed = Number(size);
  await betaSuite();
  await devSuite();
} catch (error) {
  check(
    "harness",
    false,
    error instanceof Error ? error.message : String(error),
  );
} finally {
  for (const mode of ["beta", "dev"])
    compose(join(work, `${mode}.env`), "down", "--volumes", "--remove-orphans");
  rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
process.stdout.write(
  `\n${JSON.stringify({ image: IMAGE, passed: results.length - failed.length, failed: failed.length, facts }, null, 2)}\n`,
);
process.exit(failed.length ? 1 : 0);
