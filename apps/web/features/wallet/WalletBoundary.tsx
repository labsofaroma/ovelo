"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { idleWallet, WalletContext, type WalletState } from "./context";
import { mainnetConfig, storageKey, type ClusterConfig } from "./cluster";

/**
 * Wraps trade surfaces. Renders immediately with an "idle" wallet; the wallet stack
 * (wallet-adapter, web3.js) is fetched only when the user asks to connect, or after the
 * page is idle when a previous wallet session exists (so a refresh restores the session and an
 * in-flight trade can be recovered). Pages that do not trade never include this component.
 */
type StackProps = {
  children: ReactNode;
  initiallyOpen?: boolean;
  cluster: ClusterConfig;
};

const E2E = process.env.NEXT_PUBLIC_OVELO_E2E_WALLET === "true";
const DEFAULT_CLUSTER = mainnetConfig(process.env.NEXT_PUBLIC_SOLANA_RPC_URL);

async function loadStack(): Promise<{ Stack: ComponentType<StackProps> }> {
  // The env comparison is written inline (not through E2E) on purpose: Next replaces
  // NEXT_PUBLIC_* with literals, webpack then evaluates the condition at compile time and does
  // not even parse the dead import, so no E2E chunk is emitted when it is off. The client-secret
  // scan (scripts/check-client-secrets.mjs) fails a production build otherwise.
  if (process.env.NEXT_PUBLIC_OVELO_E2E_WALLET === "true")
    return { Stack: (await import("./stack/E2EStack")).default };
  // Wallet-only login (W1): the same Wallet Standard stack on every cluster.
  const stack = await import("./stack/WalletStack");
  return { Stack: stack.default as ComponentType<StackProps> };
}

function hadSession(key: string): boolean {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

/**
 * `cluster` defaults to mainnet. Only `/invest` passes another one (devnet, or localnet in a
 * test build), built by its server page; each cluster gets its own storage key and stack.
 */
export function WalletBoundary({
  children,
  cluster = DEFAULT_CLUSTER,
}: {
  children: ReactNode;
  cluster?: ClusterConfig;
}) {
  const [want, setWant] = useState<"no" | "restore" | "open">("no");
  const [loaded, setLoaded] = useState<Awaited<
    ReturnType<typeof loadStack>
  > | null>(null);

  useEffect(() => {
    if (E2E || hadSession(storageKey(cluster.cluster))) {
      // Safari has no requestIdleCallback; a short timer keeps the stack out of first paint.
      const timer = globalThis.setTimeout(
        () => setWant((w) => (w === "no" ? "restore" : w)),
        E2E ? 0 : 1500,
      );
      return () => globalThis.clearTimeout(timer);
    }
  }, [cluster.cluster]);

  useEffect(() => {
    if (want === "no" || loaded) return;
    let live = true;
    void loadStack().then((stack) => {
      if (live) setLoaded(stack);
    });
    return () => {
      live = false;
    };
  }, [want, loaded]);

  const idle = useMemo<WalletState>(
    () => ({
      ...idleWallet,
      cluster: cluster.cluster,
      status: want === "no" ? "idle" : "loading",
      open: () => setWant("open"),
    }),
    [want, cluster.cluster],
  );

  if (!loaded)
    return (
      <WalletContext.Provider value={idle}>{children}</WalletContext.Provider>
    );
  const { Stack } = loaded;
  return (
    <Stack initiallyOpen={want === "open"} cluster={cluster}>
      {children}
    </Stack>
  );
}
