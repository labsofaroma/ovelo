import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * M5b B7: the creator E2E needs Postgres (creators, invites, baskets, receipts). It runs on the
 * LOCAL Docker Postgres + Neon WebSocket proxy (scripts/local-db.sh), reset for every run so
 * tickers and invites start clean. Nothing here can reach a real database: the app only uses the
 * proxy for a loopback DATABASE_URL (server/db/local-neon.ts).
 *
 * E2E_CREATOR=0 skips it (the M4 trade suite then runs exactly as before, receipts in memory).
 */
export function creatorEnabled(): boolean {
  return process.env.E2E_CREATOR !== "0";
}

/**
 * The env both the app and Playwright get: the local Postgres when the creator suite runs, and
 * Phase A's settings: the private-beta gate, on exactly when that database is there
 * (beta-gate.spec.ts), and the W3 caps at the beta defaults ($50 per trade, $200 per day). `next
 * start` is production, where unset caps are refused. The caps live in Postgres, so from Phase A
 * on the purchase specs need the local database (E2E_CREATOR=0 leaves trading failing closed).
 */
export function localDbEnv(web: string): Record<string, string> {
  const caps = {
    AROMA_MAX_TRADE_USDC_RAW: "50000000",
    AROMA_MAX_DAILY_USDC_RAW: "200000000",
  };
  if (!creatorEnabled())
    return { ...caps, AROMA_BETA_GATE: "off", E2E_BETA_GATE: "off" };
  return {
    ...startLocalDb(web),
    ...caps,
    AROMA_BETA_GATE: "on",
    E2E_BETA_GATE: "on",
  };
}

export function startLocalDb(web: string): Record<string, string> {
  const script = join(web, "scripts/local-db.sh");
  execFileSync(script, ["reset"], { cwd: web, stdio: "inherit" });
  const env: Record<string, string> = {};
  for (const line of execFileSync(script, ["env"], {
    cwd: web,
    encoding: "utf8",
  }).split("\n")) {
    const match = /^export ([A-Z_]+)='([^']*)'$/.exec(line.trim());
    if (match) env[match[1]!] = match[2]!;
  }
  if (!env.DATABASE_URL || !env.AROMA_LOCAL_NEON_WS_PROXY)
    throw new Error("local-db did not report DATABASE_URL and the proxy");
  return env;
}

/** The creator builds a basket from the chosen curated basket's assets, in the same order, so
 *  the builder's equal weights give the same per-leg amounts as the recorded Jupiter routes. */
export function creatorLegs(
  legs: readonly { outputMint: string }[],
  symbolOf: ReadonlyMap<string, string>,
): string {
  return JSON.stringify(
    legs.map((leg) => ({
      mint: leg.outputMint,
      symbol: symbolOf.get(leg.outputMint) ?? "",
    })),
  );
}
