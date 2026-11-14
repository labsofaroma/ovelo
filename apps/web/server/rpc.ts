import "server-only";
import { Connection } from "@solana/web3.js";
import { AppError } from "./errors";
import { tryGetEnv } from "./env";

/**
 * Solana connections behind a `Cluster` brand.
 *
 * A `ClusterConnection<"mainnet-beta">` can only be produced by `verifyGenesis`, which asks the
 * RPC node for its genesis hash and refuses to continue unless it matches the cluster. A devnet
 * connection therefore cannot be passed where mainnet is required (compile time), and a
 * mislabelled endpoint is rejected at runtime. The identity of the cluster is taken from the
 * RPC, never inferred from its URL. Ported from the prototype's devnet-connection.ts and
 * mainnet-connection.ts (AGENTS.md non-negotiable 3).
 */

export type Cluster = "mainnet-beta" | "devnet";

/** Genesis hashes; every v1 copy is pinned against these in rpc.test.ts. */
export const GENESIS_HASHES = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
} as const satisfies Record<Cluster, string>;

declare const clusterBrand: unique symbol;
export type ClusterConnection<C extends Cluster> = Connection & {
  readonly [clusterBrand]: C;
};

export const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
const REQUEST_TIMEOUT_MS = 12_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export type ConnectionOptions = { timeoutMs?: number; fetch?: FetchLike };

/** Mainnet needs a dedicated HTTPS endpoint that does not look like devnet/testnet. */
export function assertMainnetRpcUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "mainnet RPC URL is not a valid URL",
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    /(^|[./-])(devnet|testnet)([./-]|$)/i.test(url.hostname + url.pathname)
  ) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "configure a dedicated HTTPS Solana mainnet RPC",
    });
  }
  return url.toString();
}

/** Devnet accepts HTTPS, or HTTP only on loopback. Never reads mainnet or browser variables. */
export function assertDevnetRpcUrl(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "devnet RPC URL is not a valid URL",
    });
  }
  const local = LOOPBACK.has(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "configure an HTTPS devnet RPC endpoint",
    });
  }
  return url.toString();
}

function buildConnection(
  url: string,
  options: ConnectionOptions = {},
): Connection {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const base: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init));
  return new Connection(url, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      base(input, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })) as typeof fetch,
  });
}

/**
 * Ask the node for its genesis hash and return the branded connection only if it matches.
 * Call on every new operation, as the prototype did, so a swapped endpoint is caught at once.
 */
export async function verifyGenesis<C extends Cluster>(
  connection: Connection,
  cluster: C,
): Promise<ClusterConnection<C>> {
  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch (cause) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: `${cluster} RPC is unavailable`,
      cause,
    });
  }
  if (genesis !== GENESIS_HASHES[cluster]) {
    throw new AppError("WRONG_CLUSTER", {
      detail: `RPC configured for ${cluster} reported a different cluster's genesis hash`,
    });
  }
  return connection as ClusterConnection<C>;
}

/** Build and verify a connection to a given URL (used by the getters below and by tests). */
export async function connectToCluster<C extends Cluster>(
  cluster: C,
  url: string,
  options: ConnectionOptions = {},
): Promise<ClusterConnection<C>> {
  const checked =
    cluster === "mainnet-beta"
      ? assertMainnetRpcUrl(url)
      : assertDevnetRpcUrl(url);
  return verifyGenesis(buildConnection(checked, options), cluster);
}

const cache = new Map<string, Connection>();

function cached(cluster: Cluster, url: string): Connection {
  const key = `${cluster}|${url}`;
  let connection = cache.get(key);
  if (!connection) {
    connection = buildConnection(url);
    cache.set(key, connection);
  }
  return connection;
}

function envOrThrow() {
  const result = tryGetEnv();
  if (!result.ok)
    throw new AppError("SERVICE_UNAVAILABLE", {
      detail: "environment is invalid",
      cause: result.error,
    });
  return result.env;
}

/** Mainnet: SOLANA_RPC_URL only (never the devnet or browser variables). */
export async function getMainnetConnection(): Promise<
  ClusterConnection<"mainnet-beta">
> {
  const url = assertMainnetRpcUrl(
    envOrThrow().server.SOLANA_RPC_URL ?? DEFAULT_MAINNET_RPC,
  );
  return verifyGenesis(cached("mainnet-beta", url), "mainnet-beta");
}

/** Devnet: AROMA_RECURRING_RPC_URL only (never the mainnet or browser variables). */
export async function getDevnetConnection(): Promise<
  ClusterConnection<"devnet">
> {
  const url = assertDevnetRpcUrl(
    envOrThrow().devnet.AROMA_RECURRING_RPC_URL ?? DEFAULT_DEVNET_RPC,
  );
  return verifyGenesis(cached("devnet", url), "devnet");
}

export function resetRpcCacheForTests(): void {
  cache.clear();
}
