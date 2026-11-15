// Phase H Step 3: bounded graceful shutdown for the self-host server (plain ESM, no build step;
// unit-tested by apps/web/server/graceful.test.ts).
//
// On SIGTERM (or SIGINT):
//   1. stop accepting connections (server.close), and close idle keep-alive sockets;
//   2. let in-flight requests finish, up to `drainMs` (default 65 s: above the longest route
//      budget, maxDuration = 60 s for trade/quote, trade/submit and the Action POST);
//   3. close what is still open (closeAllConnections), then run the registered shutdown hooks
//      (the Postgres pool; Upstash Redis is HTTP-only, nothing to close), each bounded;
//   4. exit 0 (1 if the drain timed out or a hook failed, so the logs show it).
// A trade submit cut by the deadline is safe to retry: the request id is claimed in Redis before
// anything is broadcast, and a replay returns the stored record (features/trade/server/submit.ts).

const HOOKS = Symbol.for("ovelo.shutdown.hooks");

/**
 * Track every HTTP server created after this call, and the requests each has in flight.
 * @param {typeof import("node:http")} http
 */
export function trackServers(http) {
  /** @type {Set<import("node:http").Server>} */
  const servers = new Set();
  const state = { inFlight: 0, servers };
  const original = http.createServer;
  http.createServer = function createServer(...args) {
    const server = original.apply(this, args);
    servers.add(server);
    server.on("request", (_req, res) => {
      state.inFlight++;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        state.inFlight--;
      };
      res.on("finish", finish);
      res.on("close", finish);
    });
    return server;
  };
  return state;
}

/**
 * @param {{ inFlight: number, servers: Set<import("node:http").Server> }} state
 * @param {{ drainMs?: number, hookMs?: number, log?: (msg: string, extra?: object) => void,
 *           hooks?: () => { name: string, close: () => unknown }[] }} [options]
 * @returns {Promise<{ drained: boolean, hooksOk: boolean }>}
 */
export async function drain(state, options = {}) {
  const drainMs = options.drainMs ?? 65_000;
  const hookMs = options.hookMs ?? 5_000;
  const log = options.log ?? (() => {});
  const hooks =
    options.hooks ?? (() => /** @type {any} */ (globalThis)[HOOKS] ?? []);
  log("shutdown: draining", { inFlight: state.inFlight, drainMs });
  const closed = [...state.servers].map(
    (server) =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeIdleConnections?.();
      }),
  );
  const deadline = Date.now() + drainMs;
  while (state.inFlight > 0 && Date.now() < deadline) {
    for (const server of state.servers) server.closeIdleConnections?.();
    await new Promise((r) => setTimeout(r, 50));
  }
  const drained = state.inFlight === 0;
  if (!drained)
    log("shutdown: drain deadline reached", { inFlight: state.inFlight });
  for (const server of state.servers) server.closeAllConnections?.();
  await Promise.race([
    Promise.all(closed),
    new Promise((r) => setTimeout(r, 1_000)),
  ]);
  let hooksOk = true;
  for (const hook of hooks()) {
    try {
      await Promise.race([
        Promise.resolve().then(() => hook.close()),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), hookMs),
        ),
      ]);
      log("shutdown: closed", { hook: hook.name });
    } catch (error) {
      hooksOk = false;
      log("shutdown: hook failed", {
        hook: hook.name,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { drained, hooksOk };
}

/**
 * Install the SIGTERM/SIGINT handler (once). `exit` is injectable for tests.
 * @param {{ inFlight: number, servers: Set<import("node:http").Server> }} state
 * @param {Parameters<typeof drain>[1] & { exit?: (code: number) => void }} [options]
 */
export function installGracefulShutdown(state, options = {}) {
  const exit = options.exit ?? ((code) => process.exit(code));
  let started = false;
  const onSignal = (signal) => {
    if (started) return;
    started = true;
    options.log?.("shutdown: signal", { signal });
    drain(state, options).then(
      ({ drained, hooksOk }) => exit(drained && hooksOk ? 0 : 1),
      () => exit(1),
    );
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return onSignal;
}
