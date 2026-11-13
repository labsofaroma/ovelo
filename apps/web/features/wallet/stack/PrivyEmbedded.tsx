"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { useMemo, type ReactNode } from "react";
import type { Signer } from "../context";
import { EmbeddedContext } from "./WalletStack";
import { advertisedVersions, assertCanSign, decode, encode } from "./signing";

/**
 * Privy embedded (email) wallets, mainnet only. Loaded only when NEXT_PUBLIC_PRIVY_APP_ID is set.
 * External wallets go through wallet-adapter instead, so there is one picker and one signer path.
 */
const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

function Session({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets.find((w) => w.standardWallet.name === "Privy");

  const signer = useMemo((): Signer | null => {
    if (!ready || !authenticated || !walletsReady || !wallet) return null;
    const feature = wallet.standardWallet.features["solana:signTransaction"] as
      | { supportedTransactionVersions?: readonly (number | string)[] }
      | undefined;
    const versions = advertisedVersions(
      feature?.supportedTransactionVersions,
      true,
    );
    return {
      address: wallet.address,
      kind: "privy",
      supportedTransactionVersions: versions,
      async signTransactions(unsigned, version) {
        assertCanSign(versions, version, unsigned.length);
        const signed: string[] = [];
        for (const tx of unsigned) {
          const result = await signTransaction({
            transaction: decode(tx),
            wallet,
            chain: "solana:mainnet",
            options: { uiOptions: { showWalletUIs: true } },
          });
          signed.push(encode(result.signedTransaction));
        }
        return signed;
      },
    };
  }, [ready, authenticated, walletsReady, wallet, signTransaction]);

  const session = useMemo(
    () => ({ ready, authenticated, signer, login, logout }),
    [ready, authenticated, signer, login, logout],
  );
  return (
    <EmbeddedContext.Provider value={session}>
      {children}
    </EmbeddedContext.Provider>
  );
}

export default function PrivyEmbedded({ children }: { children: ReactNode }) {
  const config = useMemo(
    () => ({
      appearance: { walletChainType: "solana-only" as const },
      loginMethods: ["email"] as "email"[],
      embeddedWallets: {
        solana: { createOnLogin: "users-without-wallets" as const },
      },
    }),
    [],
  );
  return (
    <PrivyProvider appId={APP_ID} config={config}>
      <Session>{children}</Session>
    </PrivyProvider>
  );
}
