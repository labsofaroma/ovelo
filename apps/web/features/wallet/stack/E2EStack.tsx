"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WalletContext, type Signer, type WalletState } from "../context";

/**
 * E2E-ONLY wallet (M4 B11). Compiled into a build only when NEXT_PUBLIC_AROMA_E2E_WALLET=true at
 * BUILD time; WalletBoundary's import of this file is dead code otherwise, and the client-secret
 * scan fails a production build that contains the bridge name below.
 *
 * It holds NO key. Playwright exposes `window.aromaE2EWallet` from test code, where a
 * deterministic test-only keypair signs; the page only passes base64 bytes across.
 */
type Bridge = {
  address: string;
  sign: (unsigned: string[]) => Promise<string[]>;
};

export default function E2EStack({
  children,
  initiallyOpen = false,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  // A connect click made before this chunk loaded still connects.
  const [connected, setConnected] = useState(initiallyOpen);
  useEffect(() => {
    const found = (window as unknown as { aromaE2EWallet?: Bridge })
      .aromaE2EWallet;
    if (found) setBridge(found);
  }, []);
  const value = useMemo<WalletState>(() => {
    const signer: Signer | null =
      bridge && connected
        ? {
            address: bridge.address,
            kind: "e2e",
            supportedTransactionVersions: [0, 1],
            signTransactions: (unsigned) => bridge.sign([...unsigned]),
          }
        : null;
    return {
      status: signer ? "connected" : "disconnected",
      signer,
      options: bridge
        ? [{ name: "E2E test wallet", icon: null, ready: true }]
        : [],
      embedded: false,
      error: null,
      open: () => setConnected(Boolean(bridge)),
      select: () => setConnected(Boolean(bridge)),
      loginEmbedded: () => {},
      disconnect: () => setConnected(false),
    };
  }, [bridge, connected]);
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
