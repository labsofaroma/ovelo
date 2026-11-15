/**
 * Phase H Step 3: process-wide shutdown hooks. Server modules register a close function (the
 * Postgres pool); the self-host entry point (deploy/server.mjs) runs them on SIGTERM after the
 * HTTP drain. The registry lives on globalThis under a registered symbol, so the plain-JS entry
 * point and the bundled server code share it. Never throws; each hook is bounded by the caller.
 */
type Hook = { name: string; close: () => Promise<void> | void };

const KEY = Symbol.for("aroma.shutdown.hooks");
type Registry = { [KEY]?: Hook[] };

export function registerShutdown(name: string, close: Hook["close"]): void {
  const registry = globalThis as Registry;
  (registry[KEY] ??= []).push({ name, close });
}

/** The hooks registered so far (deploy/graceful.mjs reads the same symbol). */
export function shutdownHooks(): readonly Hook[] {
  return (globalThis as Registry)[KEY] ?? [];
}
