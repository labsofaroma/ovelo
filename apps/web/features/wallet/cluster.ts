/**
 * Which Solana cluster a wallet boundary serves (M7 B2). Pure and client-safe.
 *
 * M4 made the wallet mainnet-only. Recurring investing (`/v1/invest`) runs on devnet, so a
 * boundary is now scoped to ONE cluster, chosen by the server page that renders it:
 * - `mainnet`: every trade surface (the default; unchanged behaviour).
 * - `devnet`: `/v1/invest` only. The browser RPC must report devnet's genesis.
 * - `localnet`: test builds only (`NEXT_PUBLIC_AROMA_LOCALNET=true` at BUILD time, refused in
 *   production by the env schema and by the client-secret scan), for the E2E on a local
 *   validator. Its genesis is random per validator, so the server passes the one it verified.
 *
 * Each cluster has its own wallet-adapter storage key and its own React tree, so no signer or
 * session state is shared between clusters, and every Signer carries the cluster it was made for.
 */

export type WalletCluster = "mainnet" | "devnet" | "localnet";

export type ClusterConfig = {
  cluster: WalletCluster;
  /** The browser RPC endpoint for this cluster. */
  rpcUrl: string;
  /** The genesis hash the RPC must report. */
  genesisHash: string;
};

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEFAULT_MAINNET_BROWSER_RPC =
  "https://api.mainnet-beta.solana.com";
export const DEFAULT_DEVNET_BROWSER_RPC = "https://api.devnet.solana.com";

/** Wallet Standard chain ids. */
export const CHAIN_ID: Record<WalletCluster, string> = {
  mainnet: "solana:mainnet",
  devnet: "solana:devnet",
  localnet: "solana:localnet",
};
const KNOWN_CHAIN = /^solana:(mainnet|devnet|testnet|localnet)$/;

/** The persistent label every devnet or localnet surface shows (PRODUCT.md labelling rule). */
export const CLUSTER_LABEL: Record<WalletCluster, string | null> = {
  mainnet: null,
  devnet: "Devnet: test tokens, no real value",
  localnet: "Localnet test build: test tokens, no real value",
};

export function wrongNetworkMessage(cluster: WalletCluster): string {
  switch (cluster) {
    case "mainnet":
      return "Aroma trades on Solana mainnet only. Switch your wallet or network to mainnet.";
    case "devnet":
      return "Recurring investing runs on Solana devnet only. Switch your wallet or network to devnet.";
    case "localnet":
      return "This test build runs on a local validator only. Switch the test wallet to localnet.";
  }
}

/** Short text for the wrong-network button. */
export const WRONG_NETWORK_SHORT: Record<WalletCluster, string> = {
  mainnet: "Wrong network: mainnet only",
  devnet: "Wrong network: devnet only",
  localnet: "Wrong network: localnet only",
};

/**
 * wallet-adapter's autoConnect key. Mainnet keeps the M4 key so existing sessions restore;
 * devnet and localnet get their own, so a devnet session never auto-connects on a mainnet page.
 */
export function storageKey(cluster: WalletCluster): string {
  if (cluster === "mainnet") return "walletName";
  if (cluster === "devnet") return "aroma.wallet.devnet";
  // Written inline so production builds (flag "false") drop the localnet marker entirely.
  return process.env.NEXT_PUBLIC_AROMA_LOCALNET === "true"
    ? "aromaLocalnetCluster"
    : "aroma.wallet.localnet-unavailable";
}

export function mainnetConfig(rpcUrl?: string): ClusterConfig {
  return {
    cluster: "mainnet",
    rpcUrl: rpcUrl || DEFAULT_MAINNET_BROWSER_RPC,
    genesisHash: MAINNET_GENESIS,
  };
}

export function devnetConfig(rpcUrl?: string): ClusterConfig {
  return {
    cluster: "devnet",
    rpcUrl: rpcUrl || DEFAULT_DEVNET_BROWSER_RPC,
    genesisHash: DEVNET_GENESIS,
  };
}

const LOOPBACK_RPC = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
const BASE58_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * A localnet boundary, or null. Null unless this is a test build: the condition is written
 * inline so Next replaces it with a literal and the bundler drops the rest of the body (and the
 * marker in `storageKey`) from production builds. Also null for a non-loopback RPC or a genesis
 * that belongs to mainnet or devnet.
 */
export function localnetConfig(
  rpcUrl: string,
  genesisHash: string,
): ClusterConfig | null {
  if (process.env.NEXT_PUBLIC_AROMA_LOCALNET !== "true") return null;
  if (!LOOPBACK_RPC.test(rpcUrl) || !BASE58_HASH.test(genesisHash)) return null;
  if (genesisHash === MAINNET_GENESIS || genesisHash === DEVNET_GENESIS)
    return null;
  return { cluster: "localnet", rpcUrl, genesisHash };
}

/**
 * A Wallet Standard account may declare the chains it serves. An account that declares chains
 * but not this cluster's is refused. Mainnet keeps M4's rule: an account with no chains, or one
 * that declares only unknown chains, is accepted (the RPC genesis check still applies).
 */
export function accountOnCluster(
  chains: readonly string[] | undefined,
  cluster: WalletCluster,
): boolean {
  if (!chains || chains.length === 0) return true;
  if (chains.includes(CHAIN_ID[cluster])) return true;
  return !chains.some((chain) => KNOWN_CHAIN.test(chain));
}

/** The browser RPC must report exactly the expected genesis; any failure counts as wrong. */
export async function rpcReportsGenesis(
  endpoint: string,
  genesisHash: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
    });
    const body = (await response.json()) as { result?: unknown };
    return body.result === genesisHash;
  } catch {
    return false;
  }
}

/**
 * Callers that sign on one cluster assert the signer was made for it, so a signer from another
 * boundary can never sign there (defence in depth on top of separate React trees).
 */
export function assertSignerCluster(
  signer: { cluster: WalletCluster } | null,
  cluster: WalletCluster,
): void {
  if (!signer) throw new Error("Connect a wallet first.");
  if (signer.cluster !== cluster) throw new Error(wrongNetworkMessage(cluster));
}
