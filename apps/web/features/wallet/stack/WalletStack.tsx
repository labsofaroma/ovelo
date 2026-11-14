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
 * The wallet bridge (M4 B2): wallet-adapter for desktop extensions (Wallet Standard
 * auto-discovery), plus Privy for embedded wallets when NEXT_PUBLIC_PRIVY_APP_ID is set.
 * This is the ONLY place v1 code uses @solana/web3.js (V0 fallback for legacy adapters).
 * One cluster per stack (M7 B2): the browser RPC must report that cluster's genesis, and an
 * account that declares only other chains is refused. Mainnet unless the page scopes it.
 */

export type EmbeddedSession = {
  ready: boolean;
  authenticated: boolean;
  signer: Signer | null;
  login: () => void;
  logout: () => Promise<void>;
};
export const EmbeddedContext = createContext<EmbeddedSession | null>(null);

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
  const embedded = useContext(EmbeddedContext);
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
  // Embedded (Privy) signers exist on mainnet only; a signer from another cluster is never used.
  const embeddedSigner =
    embedded?.signer?.cluster === cluster.cluster ? embedded.signer : null;
  const signer = adapterSigner ?? embeddedSigner;
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
      embedded: Boolean(embedded),
      error:
        error ??
        (status === "wrong-network" ? wrongNetworkMessage(cluster.cluster) : null),
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
    [status, signer, adapter, embedded, error, select, cluster.cluster],
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
  cluster,
  Embedded,
}: {
  children: ReactNode;
  initiallyOpen?: boolean;
  cluster: ClusterConfig;
  /** Privy provider (loaded only when an app id is configured, on mainnet). */
  Embedded?: (props: { children: ReactNode }) => ReactNode;
}) {
  const wallets = useMemo(() => [], []);
  const inner = (
    <Bridge initiallyOpen={initiallyOpen} cluster={cluster}>
      {children}
    </Bridge>
  );
  const Wrap = cluster.cluster === "mainnet" ? Embedded : undefined;
  return (
    <ConnectionProvider endpoint={cluster.rpcUrl}>
      <AdapterProvider
        wallets={wallets}
        autoConnect
        localStorageKey={storageKey(cluster.cluster)}
      >
        {Wrap ? <Wrap>{inner}</Wrap> : inner}
      </AdapterProvider>
    </ConnectionProvider>
  );
}
