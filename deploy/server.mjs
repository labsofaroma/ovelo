// Phase H Step 3: the self-host entry point (the image's CMD). It starts Next's traced standalone
// server with a bounded graceful shutdown in front:
// - NEXT_MANUAL_SIG_HANDLE=true (set in the image) stops Next from exiting on SIGTERM itself;
// - every HTTP server Next creates is tracked, and SIGTERM drains it (deploy/graceful.mjs).
// Logs are one JSON line each on stdout, like the app's logger. Nothing secret is printed.
import { existsSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { installGracefulShutdown, trackServers } from "./graceful.mjs";

const log = (msg, extra = {}) =>
  process.stdout.write(
    `${JSON.stringify({ level: "info", time: Date.now(), msg, ...extra })}\n`,
  );

if (process.env.NEXT_MANUAL_SIG_HANDLE !== "true") {
  log("startup: NEXT_MANUAL_SIG_HANDLE must be true (set in the image)");
  process.exit(1);
}

// The local fork-E2E image (test wallet bridge compiled in) must never serve a production or beta
// deployment, whatever the env file says. The env schema refuses it too, but only from the env.
const e2eBuild = existsSync(new URL("./E2E_BUILD", import.meta.url));
const env = process.env;
const productionLike =
  // This entry point runs only on self-host; a missing platform answer counts as production.
  ["production", "beta"].includes(env.AROMA_DEPLOY_ENV?.trim() ?? "") ||
  !env.AROMA_PLATFORM?.trim();
if (e2eBuild && productionLike) {
  log(
    "startup: refusing to run the fork-E2E image on a production or beta deployment",
  );
  process.exit(1);
}

const drainMs = Number(process.env.AROMA_DRAIN_MS ?? 65_000);
const state = trackServers(http);
installGracefulShutdown(state, {
  drainMs: Number.isFinite(drainMs) && drainMs > 0 ? drainMs : 65_000,
  log,
});

// The traced standalone server (monorepo layout: apps/web/server.js next to this directory).
createRequire(import.meta.url)("../apps/web/server.js");
