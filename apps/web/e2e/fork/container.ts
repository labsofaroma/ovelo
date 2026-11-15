import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGIN_SECRET } from "../local-start";

/**
 * Phase H Step 8: `E2E_TARGET=container` runs the fork E2E against the IMAGE instead of a local
 * `next start`: the production compose file + compose.local.yml, with
 * - the fork-E2E variant of the image (`docker build --target runtime-e2e -t ovelo-web:e2e`),
 * - the Cloudflare stand-in on the app port (Playwright talks to it like a browser to the edge:
 *   it never knows the origin secret, it only says where the client "is"),
 * - the loopback bridge, so the app reaches the fork's loopback services at the same URLs.
 * Memory is sampled while the suite runs; the peak is printed at the end.
 */
const COMPOSE = [
  "compose",
  "-f",
  "../../deploy/hostinger/docker-compose.yml",
  "-f",
  "../../deploy/hostinger/compose.local.yml",
  "--profile",
  "bridge",
];

function loopbackPorts(env: Record<string, string>): string {
  const ports = new Set<number>();
  for (const value of Object.values(env)) {
    for (const m of value.matchAll(
      /(?:\/\/|^)(?:[^@/\s]*@)?(?:127\.0\.0\.1|localhost):(\d{2,5})/g,
    ))
      ports.add(Number(m[1]));
  }
  ports.delete(3000);
  return [...ports].sort((a, b) => a - b).join(",");
}

export function startContainerApp(
  appEnv: Record<string, string>,
  work: string,
  port: number,
): () => void {
  // Playwright (a child process) and this runner now talk to the stand-in (e2e/local-start.ts).
  process.env.OVELO_E2E_EDGE_PROXY = "1";
  const envFile = join(work, "container.env");
  const secretFile = join(work, "origin.secret");
  const lines = Object.entries(appEnv)
    .filter(([k]) => k !== "OVELO_NEXT_DIST_DIR" && k !== "NODE_ENV")
    .map(([k, v]) => {
      if (/[\r\n]/.test(v)) throw new Error(`${k} has a newline`);
      return `${k}=${v}`;
    });
  writeFileSync(envFile, `${lines.join("\n")}\n`, { mode: 0o600 });
  writeFileSync(secretFile, ORIGIN_SECRET);
  chmodSync(secretFile, 0o644); // the stand-in runs as UID 1000
  const env = {
    ...process.env,
    OVELO_IMAGE: process.env.E2E_IMAGE ?? "ovelo-web:e2e",
    OVELO_LOCAL_ENV_FILE: envFile,
    OVELO_LOCAL_SECRET_FILE: secretFile,
    OVELO_LOCAL_EDGE_PORT: String(port),
    // The browser is at http://127.0.0.1:<port>: keep its Host and scheme (the same-origin check).
    OVELO_LOCAL_EDGE_HOST: "",
    OVELO_LOCAL_EDGE_SCHEME: "http",
    BRIDGE_PORTS: loopbackPorts(appEnv),
  };
  const compose = (...args: string[]) =>
    spawnSync("docker", [...COMPOSE, ...args], { env, encoding: "utf8" });
  compose("down", "--volumes", "--remove-orphans");
  const up = compose(
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "180",
    "app",
    "edge",
    "bridge",
  );
  if (up.status !== 0)
    throw new Error(`container app did not start: ${up.stderr.slice(-1500)}`);
  process.stdout.write(`[container] up; bridged ports ${env.BRIDGE_PORTS}\n`);
  const id = compose("ps", "-q", "app").stdout.trim();
  let peakMiB = 0;
  const timer = setInterval(() => {
    try {
      const usage = execFileSync(
        "docker",
        ["stats", "--no-stream", "--format", "{{.MemUsage}}", id],
        { encoding: "utf8" },
      );
      const m = /([\d.]+)(MiB|GiB)/.exec(usage);
      if (m) {
        const mib = Number(m[1]) * (m[2] === "GiB" ? 1024 : 1);
        peakMiB = Math.max(peakMiB, mib);
      }
    } catch {
      /* sampling is best effort */
    }
  }, 3_000);
  return () => {
    clearInterval(timer);
    const logs = compose("logs", "--no-color", "app").stdout;
    writeFileSync(join(work, "container-app.log"), logs);
    process.stdout.write(
      `[container] peak memory ${peakMiB.toFixed(0)} MiB; secret in logs: ${logs.includes(ORIGIN_SECRET) ? "YES (FAIL)" : "no"}\n`,
    );
    compose("down", "--volumes", "--remove-orphans");
  };
}
