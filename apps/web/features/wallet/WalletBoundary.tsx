"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { idleWallet, WalletContext, type WalletState } from "./context";

/**
 * Wraps trade surfaces. Renders immediately with an "idle" wallet; the wallet stack
 * (wallet-adapter, Privy, web3.js) is fetched only when the user asks to connect, or after the
 * page is idle when a previous wallet session exists (so a refresh restores the session and an
 * in-flight trade can be recovered). Pages that do not trade never include this component.
 */
type StackProps = {
  children: ReactNode;
  initiallyOpen?: boolean;
  Embedded?: ComponentType<{ children: ReactNode }>;
};

const E2E = process.env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true";

async function loadStack(): Promise<{
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
    process.env.NEXT_PUBLIC_PRIVY_APP_ID
      ? import("./stack/PrivyEmbedded")
      : Promise.resolve(null),
  ]);
  return {
    Stack: stack.default as ComponentType<StackProps>,
    Embedded: embedded?.default,
  };
}

function hadSession(): boolean {
  try {
    return Boolean(localStorage.getItem("walletName"));
  } catch {
    return false;
  }
}

export function WalletBoundary({ children }: { children: ReactNode }) {
  const [want, setWant] = useState<"no" | "restore" | "open">("no");
  const [loaded, setLoaded] = useState<Awaited<
    ReturnType<typeof loadStack>
  > | null>(null);

  useEffect(() => {
    if (E2E || hadSession()) {
      // Safari has no requestIdleCallback; a short timer keeps the stack out of first paint.
      const timer = globalThis.setTimeout(
        () => setWant((w) => (w === "no" ? "restore" : w)),
        E2E ? 0 : 1500,
      );
      return () => globalThis.clearTimeout(timer);
    }
  }, []);

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
      status: want === "no" ? "idle" : "loading",
      open: () => setWant("open"),
    }),
    [want],
  );

  if (!loaded)
    return (
      <WalletContext.Provider value={idle}>{children}</WalletContext.Provider>
    );
  const { Stack, Embedded } = loaded;
  return (
    <Stack initiallyOpen={want === "open"} Embedded={Embedded}>
      {children}
    </Stack>
  );
}
