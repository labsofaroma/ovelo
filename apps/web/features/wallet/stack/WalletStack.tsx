"use client";

import {
  ConnectionProvider,
  WalletProvider as AdapterProvider,
  useWallet as useAdapter,
} from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { VersionedTransaction } from "@solana/web3.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  WalletContext,
  type Signer,
  type TransactionVersion,
  type WalletState,
} from "../context";
import { WalletPicker } from "./WalletPicker";
import {
  accountOnMainnet,
  advertisedVersions,
  assertCanSign,
  decode,
  encode,
  rpcIsMainnet,
  signWithStandard,
  type StandardSignFeature,
} from "./signing";

/**
 * The wallet bridge (M4 B2): wallet-adapter for desktop extensions (Wallet Standard
 * auto-discovery), plus Privy for embedded wallets when NEXT_PUBLIC_PRIVY_APP_ID is set.
 * This is the ONLY place v1 code uses @solana/web3.js (V0 fallback for legacy adapters).
 * Mainnet only: the browser RPC must report mainnet's genesis, and an account that only declares
 * devnet/testnet chains is refused.
 */

export type EmbeddedSession = {
  ready: boolean;
  authenticated: boolean;
  signer: Signer | null;
  login: () => void;
  logout: () => Promise<void>;
};
export const EmbeddedContext = createContext<EmbeddedSession | null>(null);

const ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

type StandardWallet = {
  accounts: readonly {
    address: string;
    features?: readonly string[];
    chains?: readonly string[];
  }[];
  features: Record<string, unknown>;
};

function Bridge({
  children,
  initiallyOpen,
}: {
  children: ReactNode;
  initiallyOpen: boolean;
}) {
  const adapter = useAdapter();
  const embedded = useContext(EmbeddedContext);
  const [picker, setPicker] = useState(initiallyOpen);
  const [network, setNetwork] = useState<"checking" | "mainnet" | "wrong">(
    "checking",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void rpcIsMainnet(ENDPOINT).then((ok) => {
      if (live) setNetwork(ok ? "mainnet" : "wrong");
    });
    return () => {
      live = false;
    };
  }, []);

  const address = adapter.publicKey?.toBase58() ?? null;
  const standard = (
    adapter.wallet?.adapter as unknown as { wallet?: StandardWallet }
  )?.wallet;
  const feature = standard?.features["solana:signTransaction"] as
    StandardSignFeature | undefined;
  const account = standard?.accounts.find((item) => item.address === address);

  const adapterSigner = useMemo((): Signer | null => {
    if (!adapter.connected || !address) return null;
    const standardVersions = advertisedVersions(
      feature?.supportedTransactionVersions,
      Boolean(
        account?.features?.includes("solana:signTransaction") &&
        feature?.signTransaction,
      ),
    );
    const legacyV0 =
      adapter.signTransaction &&
      adapter.wallet?.adapter.supportedTransactionVersions?.has(0);
    const versions = [
      ...new Set<TransactionVersion>([
        ...standardVersions,
        ...(legacyV0 ? [0 as const] : []),
      ]),
    ];
    return {
      address,
      kind: standardVersions.length ? "standard" : "adapter",
      supportedTransactionVersions: versions,
      async signTransactions(unsigned, version) {
        assertCanSign(versions, version, unsigned.length);
        if (standardVersions.includes(version) && feature)
          return signWithStandard(feature, account, unsigned);
        // Legacy adapters: V0 only, through web3.js.
        const transactions = unsigned.map((tx) =>
          VersionedTransaction.deserialize(decode(tx)),
        );
        if (adapter.signAllTransactions && transactions.length > 1)
          return (await adapter.signAllTransactions(transactions)).map((t) =>
            encode(t.serialize()),
          );
        const signed: string[] = [];
        for (const tx of transactions)
          signed.push(encode((await adapter.signTransaction!(tx)).serialize()));
        return signed;
      },
    };
  }, [adapter, address, account, feature]);

  const wrongAccount = Boolean(account && !accountOnMainnet(account.chains));
  const signer = adapterSigner ?? embedded?.signer ?? null;
  const status: WalletState["status"] =
    network === "wrong" || wrongAccount
      ? "wrong-network"
      : network === "checking"
        ? "loading"
        : signer
          ? "connected"
          : adapter.connecting
            ? "connecting"
            : "disconnected";

  const select = useCallback(
    (name: string) => {
      setError(null);
      setPicker(false);
      try {
        adapter.select(name as WalletName);
      } catch {
        setError("This wallet could not be selected.");
      }
    },
    [adapter],
  );

  const value = useMemo<WalletState>(
    () => ({
      status,
      signer: status === "connected" ? signer : null,
      options: adapter.wallets.map((w) => ({
        name: w.adapter.name,
        icon: w.adapter.icon ?? null,
        ready: w.readyState === "Installed" || w.readyState === "Loadable",
      })),
      embedded: Boolean(embedded),
      error:
        error ??
        (status === "wrong-network"
          ? "Aroma trades on Solana mainnet only. Switch your wallet or network to mainnet."
          : null),
      open: () => setPicker(true),
      select,
      loginEmbedded: () => {
        setPicker(false);
        embedded?.login();
      },
      disconnect: () => {
        void adapter.disconnect().catch(() => {});
        void embedded?.logout().catch(() => {});
      },
    }),
    [status, signer, adapter, embedded, error, select],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPicker open={picker} onOpenChange={setPicker} state={value} />
    </WalletContext.Provider>
  );
}

export default function WalletStack({
  children,
  initiallyOpen = false,
  Embedded,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
  /** Privy provider (loaded only when an app id is configured). */
  Embedded?: (props: { children: ReactNode }) => ReactNode;
}) {
  const wallets = useMemo(() => [], []);
  const inner = <Bridge initiallyOpen={initiallyOpen}>{children}</Bridge>;
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <AdapterProvider wallets={wallets} autoConnect>
        {Embedded ? <Embedded>{inner}</Embedded> : inner}
      </AdapterProvider>
    </ConnectionProvider>
  );
}
