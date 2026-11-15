"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WalletContext, type Signer, type WalletState } from "../context";
import {
  accountOnCluster,
  rpcReportsGenesis,
  wrongNetworkMessage,
  type ClusterConfig,
} from "../cluster";
import { decode, encode } from "./signing";

/**
 * E2E-ONLY wallet (M4 B11). Compiled into a build only when NEXT_PUBLIC_OVELO_E2E_WALLET=true at
 * BUILD time; WalletBoundary's import of this file is dead code otherwise, and the client-secret
 * scan fails a production build that contains the bridge name below.
 *
 * It holds NO key. Playwright exposes `window.oveloE2EWallet` from test code, where a
 * deterministic test-only keypair signs; the page only passes base64 bytes across.
 *
 * M7 B2: the bridge may declare `chains`, and the boundary's cluster rules apply as for a real
 * wallet (account chains, and on devnet/localnet the browser RPC's genesis), so the E2E can prove
 * refusals. On mainnet the M4 fork E2E stands a local fork in for mainnet (its genesis is not
 * mainnet's), so the RPC genesis check stays with WalletStack there, as in M4.
 */
type Bridge = {
  address: string;
  /** Wallet Standard chains the test account declares (unset: none declared). */
  chains?: string[];
  sign: (unsigned: string[]) => Promise<string[]>;
  /** Base64 message bytes in, base64 64-byte Ed25519 signature out (M5b B1). */
  signMessage?: (message: string) => Promise<string>;
};

export default function E2EStack({
  children,
  initiallyOpen = false,
  cluster,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
  cluster: ClusterConfig;
}) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  // A connect click made before this chunk loaded still connects.
  const [connected, setConnected] = useState(initiallyOpen);
  const [network, setNetwork] = useState<"checking" | "ok" | "wrong">(
    "checking",
  );
  useEffect(() => {
    const found = (window as unknown as { oveloE2EWallet?: Bridge })
      .oveloE2EWallet;
    if (found) setBridge(found);
  }, []);
  useEffect(() => {
    if (cluster.cluster === "mainnet") {
      setNetwork("ok");
      return;
    }
    let live = true;
    void rpcReportsGenesis(cluster.rpcUrl, cluster.genesisHash).then((ok) => {
      if (live) setNetwork(ok ? "ok" : "wrong");
    });
    return () => {
      live = false;
    };
  }, [cluster.cluster, cluster.rpcUrl, cluster.genesisHash]);
  const value = useMemo<WalletState>(() => {
    const wrong =
      network === "wrong" ||
      Boolean(bridge && !accountOnCluster(bridge.chains, cluster.cluster));
    const signer: Signer | null =
      bridge && connected && network === "ok" && !wrong
        ? {
            address: bridge.address,
            kind: "e2e",
            cluster: cluster.cluster,
            supportedTransactionVersions: [0, 1],
            signTransactions: (unsigned) => bridge.sign([...unsigned]),
            signMessage: bridge.signMessage
              ? async (message) =>
                  decode(await bridge.signMessage!(encode(message)))
              : null,
          }
        : null;
    return {
      cluster: cluster.cluster,
      status:
        connected && wrong
          ? "wrong-network"
          : signer
            ? "connected"
            : connected && network === "checking"
              ? "loading"
              : "disconnected",
      signer,
      options: bridge
        ? [{ name: "E2E test wallet", icon: null, ready: true }]
        : [],
      error: connected && wrong ? wrongNetworkMessage(cluster.cluster) : null,
      open: () => setConnected(Boolean(bridge)),
      select: () => setConnected(Boolean(bridge)),
      disconnect: () => setConnected(false),
    };
  }, [bridge, connected, network, cluster.cluster]);
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
