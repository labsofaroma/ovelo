import type * as http from "node:http";

export type ServerState = { inFlight: number; servers: Set<http.Server> };
export type ShutdownHook = { name: string; close: () => unknown };
export type DrainOptions = {
  drainMs?: number;
  hookMs?: number;
  log?: (msg: string, extra?: object) => void;
  hooks?: () => readonly ShutdownHook[];
};

export function trackServers(module: typeof http): ServerState;
export function drain(
  state: ServerState,
  options?: DrainOptions,
): Promise<{ drained: boolean; hooksOk: boolean }>;
export function installGracefulShutdown(
  state: ServerState,
  options?: DrainOptions & { exit?: (code: number) => void },
): (signal: string) => void;
