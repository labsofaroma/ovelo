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
 * (wallet-adapter, Privy, web3.js) is fetched only when the user asks to connect, or after the
 * page is idle when a previous wallet session exists (so a refresh restores the session and an
 * in-flight trade can be recovered). Pages that do not trade never include this component.
 */
type StackProps = {
  children: ReactNode;
  initiallyOpen?: boolean;
  cluster: ClusterConfig;
  Embedded?: ComponentType<{ children: ReactNode }>;
};

const E2E = process.env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true";
const DEFAULT_CLUSTER = mainnetConfig(process.env.NEXT_PUBLIC_SOLANA_RPC_URL);

async function loadStack(mainnet: boolean): Promise<{
  Stack: ComponentType<StackProps>;
  Embedded?: ComponentType<{ children: ReactNode }>;
}> {
  // The env comparisons are written inline (not through E2E/PRIVY) on purpose: Next replaces
  // NEXT_PUBLIC_* with literals, webpack then evaluates the condition at compile time and does
  // not even parse the dead import, so no E2E or Privy chunk is emitted when they are off. The
  // client-secret scan (scripts/check-client-secrets.mjs) fails a production build otherwise.
  if (process.env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true")
    return { Stack: (await import("./stack/E2EStack")).default };
  const [stack, embedded] = await Promise.all([
    import("./stack/WalletStack"),
    // Privy embedded wallets are offered on mainnet only (M7 B2: devnet uses Wallet Standard).
    process.env.NEXT_PUBLIC_PRIVY_APP_ID && mainnet
      ? import("./stack/PrivyEmbedded")
      : Promise.resolve(null),
  ]);
  return {
    Stack: stack.default as ComponentType<StackProps>,
    Embedded: embedded?.default,
  };
}

function hadSession(key: string): boolean {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

/**
 * `cluster` defaults to mainnet. Only `/v1/invest` passes another one (devnet, or localnet in a
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
    void loadStack(cluster.cluster === "mainnet").then((stack) => {
      if (live) setLoaded(stack);
    });
    return () => {
      live = false;
    };
  }, [want, loaded, cluster.cluster]);

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
  const { Stack, Embedded } = loaded;
  return (
    <Stack
      initiallyOpen={want === "open"}
      cluster={cluster}
      Embedded={Embedded}
    >
      {children}
    </Stack>
  );
}
