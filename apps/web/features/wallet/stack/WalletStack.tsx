"use client";

import {
  ConnectionProvider,
  WalletProvider as AdapterProvider,
  useWallet as useAdapter,
} from "@solana/wallet-adapter-react";
import {
  WalletAdapterNetwork,
  type Adapter,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import { VersionedTransaction } from "@solana/web3.js";
import {
  useCallback,
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
  accountOnCluster,
  CHAIN_ID,
  rpcReportsGenesis,
  storageKey,
  wrongNetworkMessage,
  type ClusterConfig,
} from "../cluster";
import {
  advertisedVersions,
  assertCanSign,
  decode,
  encode,
  messageSigner,
  signWithStandard,
  type StandardMessageFeature,
  type StandardSignFeature,
} from "./signing";

/**
 * The wallet bridge (M4 B2): wallet-adapter with Wallet Standard auto-discovery (desktop
 * extensions, wallet in-app browsers) and, on Android, Mobile Wallet Adapter, which
 * wallet-adapter-react adds by itself. WalletConnect (when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is
 * set at build time) adds a QR code for phone wallets on desktop and a deep link on mobile; it is
 * still the user's own wallet that signs. Wallet-only login (REWRITE-PLAN §7.3 W1): no embedded or
 * email wallets, so every signer is the user's own wallet.
 * This is the ONLY place v1 code uses @solana/web3.js (V0 fallback for legacy adapters).
 * One cluster per stack (M7 B2): the browser RPC must report that cluster's genesis, and an
 * account that declares only other chains is refused. Mainnet unless the page scopes it.
 */

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
  cluster,
}: {
  children: ReactNode;
  initiallyOpen: boolean;
  cluster: ClusterConfig;
}) {
  const adapter = useAdapter();
  const [picker, setPicker] = useState(initiallyOpen);
  const [network, setNetwork] = useState<"checking" | "ok" | "wrong">(
    "checking",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void rpcReportsGenesis(cluster.rpcUrl, cluster.genesisHash).then((ok) => {
      if (live) setNetwork(ok ? "ok" : "wrong");
    });
    return () => {
      live = false;
    };
  }, [cluster.rpcUrl, cluster.genesisHash]);

  const address = adapter.publicKey?.toBase58() ?? null;
  const standard = (
    adapter.wallet?.adapter as unknown as { wallet?: StandardWallet }
  )?.wallet;
  const feature = standard?.features["solana:signTransaction"] as
    StandardSignFeature | undefined;
  const account = standard?.accounts.find((item) => item.address === address);
  const messageFeature = standard?.features["solana:signMessage"] as
    StandardMessageFeature | undefined;

  const signer = useMemo((): Signer | null => {
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
      cluster: cluster.cluster,
      supportedTransactionVersions: versions,
      signMessage: messageSigner({
        standard: messageFeature,
        account,
        legacy: adapter.signMessage,
      }),
      async signTransactions(unsigned, version) {
        assertCanSign(versions, version, unsigned.length);
        if (standardVersions.includes(version) && feature)
          return signWithStandard(
            feature,
            account,
            unsigned,
            CHAIN_ID[cluster.cluster],
          );
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
  }, [adapter, address, account, feature, messageFeature, cluster.cluster]);

  const wrongAccount = Boolean(
    account && !accountOnCluster(account.chains, cluster.cluster),
  );
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
      cluster: cluster.cluster,
      status,
      signer: status === "connected" ? signer : null,
      options: adapter.wallets.map((w) => ({
        name: w.adapter.name,
        icon: w.adapter.icon ?? null,
        ready: w.readyState === "Installed" || w.readyState === "Loadable",
      })),
      error:
        error ??
        (status === "wrong-network"
          ? wrongNetworkMessage(cluster.cluster)
          : null),
      open: () => setPicker(true),
      select,
      disconnect: () => {
        void adapter.disconnect().catch(() => {});
      },
    }),
    [status, signer, adapter, error, select, cluster.cluster],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPicker open={picker} onOpenChange={setPicker} state={value} />
    </WalletContext.Provider>
  );
}

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

/** The WalletConnect adapter for mainnet or devnet; none on localnet or without a project ID. */
function walletConnectAdapters(cluster: ClusterConfig["cluster"]): Adapter[] {
  if (!WALLETCONNECT_PROJECT_ID || typeof window === "undefined") return [];
  if (cluster !== "mainnet" && cluster !== "devnet") return [];
  const origin = window.location.origin;
  return [
    new WalletConnectWalletAdapter({
      network:
        cluster === "mainnet"
          ? WalletAdapterNetwork.Mainnet
          : WalletAdapterNetwork.Devnet,
      options: {
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: {
          name: "Ovelo",
          description: "Tokenized stocks and baskets on Solana",
          url: origin,
          icons: [`${origin}/icon.svg`],
        },
      },
    }),
  ];
}

export default function WalletStack({
  children,
  initiallyOpen = false,
  cluster,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
  cluster: ClusterConfig;
}) {
  const wallets = useMemo(
    () => walletConnectAdapters(cluster.cluster),
    [cluster.cluster],
  );
  return (
    <ConnectionProvider endpoint={cluster.rpcUrl}>
      <AdapterProvider
        wallets={wallets}
        autoConnect
        localStorageKey={storageKey(cluster.cluster)}
      >
        <Bridge initiallyOpen={initiallyOpen} cluster={cluster}>
          {children}
        </Bridge>
      </AdapterProvider>
    </ConnectionProvider>
  );
}
