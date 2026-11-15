/**
 * M11 Step 7: p95 latency of the v1 market endpoints against a running app (read-only GETs).
 *   pnpm --filter @ovelo/web perf:p95 -- --base http://127.0.0.1:3400 --n 100
 * `/api/markets` (the prototype's 2 MB JSON) became the server-rendered `/markets` page (catalog
 * from the Next data cache) and `GET /api/v1/prices` (fresh Jupiter prices). Requests run one at a
 * time; the first request of each target is a warm-up and is not counted. Prints JSON.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const base = flag("--base", "http://127.0.0.1:3400").replace(/\/$/, "");
const n = Number(flag("--n", "100"));
const pause = Number(flag("--pause-ms", "61000"));
const MINTS = [
  "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
];
const targets = [
  { name: "/markets (page)", path: "/markets" },
  { name: "/api/v1/prices", path: `/api/v1/prices?mints=${MINTS.join(",")}` },
];

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;

async function measure(path: string) {
  await fetch(`${base}${path}`).then((r) => r.arrayBuffer());
  const times: number[] = [];
  const statuses: Record<number, number> = {};
  for (let i = 0; i < n; i += 1) {
    const start = performance.now();
    const response = await fetch(`${base}${path}`);
    await response.arrayBuffer();
    times.push(performance.now() - start);
    statuses[response.status] = (statuses[response.status] ?? 0) + 1;
  }
  times.sort((a, b) => a - b);
  const ms = (v: number) => Math.round(v * 10) / 10;
  return { n, p50: ms(percentile(times, 50)), p95: ms(percentile(times, 95)), max: ms(times.at(-1)!), statuses };
}

async function main() {
  const results: Record<string, unknown> = {};
  for (const [i, target] of targets.entries()) {
    // The read rate limit is 120 per minute per IP: wait between targets.
    if (i > 0) await new Promise((r) => setTimeout(r, pause));
    results[target.name] = await measure(target.path);
  }
  process.stdout.write(`${JSON.stringify({ base, measuredAt: new Date().toISOString(), results }, null, 2)}\n`);
}
void main();
