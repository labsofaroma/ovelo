import "server-only";
import { AppError } from "@/server/errors";
import { alertEvent, tradeEvent } from "@/server/telemetry";

/**
 * Server mainnet RPC failover (M9, docs/launch/PRODUCTION-ENV.md §3). Rules:
 * 1. Every endpoint proves its genesis on its own before it serves anything, cached per URL for
 *    GENESIS_TTL_MS. A fallback is never assumed to be mainnet because the primary was. An endpoint
 *    with the wrong genesis is never used and raises an alert.
 * 2. Fail over only on transport errors, timeouts, HTTP 5xx and 429. A JSON-RPC error answer
 *    (a failed simulation, a refused sendTransaction) is returned as is and never retried elsewhere.
 * 3. Affinity: a `pinned` handle sticks to the first endpoint that answers it, so one quote's
 *    blockhash, simulation and lookup-table reads come from one node. `on(name)` reaches exactly
 *    one endpoint (submit re-sends the SAME signed bytes there, never a rebuilt transaction).
 * 4. Every request the fallback serves writes a structured log line and a Sentry breadcrumb.
 */

export type EndpointName = "primary" | "fallback";
export type RpcEndpoint = { name: EndpointName; url: string; genesis: string };
export type MainnetRpc = <T>(method: string, params?: unknown[]) => Promise<T>;
type Fetch = typeof fetch;

/** A JSON-RPC error answer (the node replied and refused). Never a reason to fail over. */
export class RpcError extends Error {
  readonly data: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.data = data;
  }
}

/** The endpoint could not answer (transport, timeout, HTTP 5xx/429): another one may. */
export class RpcUnavailable extends AppError {
  readonly failover: boolean;
  constructor(detail: string, failover: boolean, cause?: unknown) {
    super("UPSTREAM_UNAVAILABLE", { detail, cause });
    this.name = "RpcUnavailable";
    this.failover = failover;
  }
}

export const GENESIS_TTL_MS = 60_000;
/** After a failover-worthy failure an endpoint goes to the back of the queue for this long. */
export const COOLDOWN_MS = 30_000;
const TIMEOUT_MS = 12_000;

/** One JSON-RPC call to one endpoint, with the error classified for the rules above. */
export async function callEndpoint<T>(
  endpoint: RpcEndpoint,
  method: string,
  params: unknown[],
  fetchImpl: Fetch = fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new RpcUnavailable(
      `mainnet RPC ${method} transport failed`,
      true,
      cause,
    );
  }
  // Rate limiting and server errors say nothing about the request: another node may serve it.
  if (response.status === 429 || response.status >= 500)
    throw new RpcUnavailable(
      `mainnet RPC ${method} HTTP ${response.status}`,
      true,
    );
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    // A timeout or reset while reading the body is a transport failure. Anything else is not an
    // answer from a Solana node, but not a 5xx/429 either (e.g. a 401 page for a revoked key):
    // the spec allows failover only for transport, timeout, 5xx and 429.
    // A SyntaxError is a non-JSON body; a TypeError ("terminated") is a reset mid-body.
    const transport =
      cause instanceof Error &&
      ["TimeoutError", "AbortError", "TypeError"].includes(cause.name);
    throw new RpcUnavailable(
      `mainnet RPC ${method} ${transport ? "body read failed" : "returned non-JSON"}`,
      transport,
      cause,
    );
  }

  const data = (body ?? {}) as { error?: unknown; result?: T };
  if (data.error !== undefined && data.error !== null) {
    // Only a well-formed JSON-RPC error (an object with a numeric code) is a node's refusal.
    // Anything else is not an answer we can trust; callers treat it as unknown, never "refused".
    const error = data.error as { code?: unknown; message?: unknown };
    if (typeof error !== "object" || typeof error.code !== "number")
      throw new RpcUnavailable(
        `mainnet RPC ${method} returned a malformed error`,
        false,
      );
    throw new RpcError(
      typeof error.message === "string" ? error.message : "RPC error",
      data.error,
    );
  }
  if (!response.ok || !("result" in data))
    throw new RpcUnavailable(
      `mainnet RPC ${method} HTTP ${response.status}`,
      false,
    );
  return data.result as T;
}

type PoolState = {
  verified: Map<string, { ok: boolean; until: number }>;
  downUntil: Map<string, number>;
};
const state: PoolState = { verified: new Map(), downUntil: new Map() };

export function resetRpcPoolForTests(): void {
  state.verified.clear();
  state.downUntil.clear();
}

export type PoolOptions = { fetch?: Fetch; now?: () => number };

export type RpcPool = {
  endpoints: readonly RpcEndpoint[];
  /** Any verified endpoint, primary first (unless it is cooling down), failing over by the rules. */
  rpc: MainnetRpc;
  /** Sticks to the first endpoint that answers; afterwards no switching. */
  pinned: () => PinnedRpc;
  /** Exactly this endpoint (genesis-verified), or null if it is not configured. */
  on: (name: EndpointName) => MainnetRpc | null;
  /** True while the primary is cooling down after a failure (this instance's view). */
  fallbackInUse: () => boolean;
};
export type PinnedRpc = MainnetRpc & { endpoint: () => EndpointName | null };

export function createRpcPool(
  endpoints: readonly RpcEndpoint[],
  options: PoolOptions = {},
): RpcPool {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  async function verify(endpoint: RpcEndpoint): Promise<void> {
    const key = `${endpoint.genesis}|${endpoint.url}`;
    const cached = state.verified.get(key);
    if (cached && cached.until > now()) {
      if (cached.ok) return;
      throw wrongCluster(endpoint);
    }
    const genesis = await callEndpoint<string>(
      endpoint,
      "getGenesisHash",
      [],
      fetchImpl,
    );
    const ok = genesis === endpoint.genesis;
    state.verified.set(key, { ok, until: now() + GENESIS_TTL_MS });
    if (!ok) {
      alertEvent("rpc.wrong_cluster", { rpcEndpoint: endpoint.name });
      throw wrongCluster(endpoint);
    }
  }

  async function call<T>(
    endpoint: RpcEndpoint,
    method: string,
    params: unknown[],
  ) {
    await verify(endpoint);
    const served = () => {
      if (endpoint.name === "fallback")
        tradeEvent(
          "rpc.fallback_served",
          { rpcEndpoint: "fallback", method },
          "warning",
        );
    };
    try {
      const result = await callEndpoint<T>(endpoint, method, params, fetchImpl);
      served();
      return result;
    } catch (error) {
      // A JSON-RPC error answer is still the fallback serving the request.
      if (error instanceof RpcError) served();
      throw error;
    }
  }

  const order = (): RpcEndpoint[] => {
    const cooling = (e: RpcEndpoint) =>
      (state.downUntil.get(e.url) ?? 0) > now();
    return [...endpoints].sort(
      (a, b) => Number(cooling(a)) - Number(cooling(b)),
    );
  };

  /** Try endpoints in order; move on only for failover-worthy failures. Returns who answered. */
  async function failover<T>(
    method: string,
    params: unknown[],
  ): Promise<{ result: T; endpoint: RpcEndpoint }> {
    let first: unknown = null;
    for (const endpoint of order()) {
      try {
        return { result: await call<T>(endpoint, method, params), endpoint };
      } catch (error) {
        if (error instanceof RpcUnavailable && error.failover) {
          state.downUntil.set(endpoint.url, now() + COOLDOWN_MS);
          first ??= error;
          continue;
        }
        // A fallback on the wrong cluster is skipped (alerted in verify); a primary on the wrong
        // cluster is a misconfiguration and stops everything.
        if (isWrongCluster(error) && endpoint.name === "fallback") {
          first ??= error;
          continue;
        }
        throw error;
      }
    }
    throw (
      first ?? new RpcUnavailable("no mainnet RPC endpoint configured", false)
    );
  }

  const rpc: MainnetRpc = async <T>(method: string, params: unknown[] = []) =>
    (await failover<T>(method, params)).result;

  function pinned(): PinnedRpc {
    let chosen: RpcEndpoint | null = null;
    const handle = (async <T>(method: string, params: unknown[] = []) => {
      if (chosen) return call<T>(chosen, method, params);
      const { result, endpoint } = await failover<T>(method, params);
      chosen = endpoint;
      return result;
    }) as PinnedRpc;
    handle.endpoint = () => chosen?.name ?? null;
    return handle;
  }

  function on(name: EndpointName): MainnetRpc | null {
    const endpoint = endpoints.find((e) => e.name === name);
    if (!endpoint) return null;
    return <T>(method: string, params: unknown[] = []) =>
      call<T>(endpoint, method, params);
  }

  const fallbackInUse = () =>
    endpoints.length > 1 &&
    (state.downUntil.get(endpoints[0]!.url) ?? 0) > now();

  return { endpoints, rpc, pinned, on, fallbackInUse };
}

function wrongCluster(endpoint: RpcEndpoint): AppError {
  return new AppError("WRONG_CLUSTER", {
    detail: `${endpoint.name} RPC reported a genesis other than the expected cluster's`,
  });
}

const isWrongCluster = (error: unknown) =>
  error instanceof AppError && error.code === "WRONG_CLUSTER";
